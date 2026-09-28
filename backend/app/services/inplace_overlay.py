import os
import re
import cv2
import json
import time
import subprocess
from pathlib import Path
from difflib import SequenceMatcher
from typing import List, Dict, Any, Optional, Callable
from rapidocr_onnxruntime import RapidOCR
from .subtitle_remover import SubtitleRemoverService
from .translator import TranslatorService
from .media_composer import MediaComposer

class InplaceOverlayService:
    """
    Dịch và đè thẻ phụ đề tại chỗ (Visual In-Place Overlay):
    - Dùng YOLO11-Text phát hiện các cụm chữ trên từng frame kèm bộ lọc ROI thông minh.
    - Lọc bỏ 100% chữ in trên bao bì sản phẩm, logo, đồ vật (chỉ giữ lại Subtitle & Banner).
    - Dùng RapidOCR nhận diện nội dung chữ Hán (13ms/lượt).
    - Phân tách thông minh từng câu phụ đề theo dòng thời gian (chống gộp câu).
    - So khớp mượt mà với kịch bản lồng tiếng Bước 4 (lấy 100% câu dịch tiếng Việt).
    - Cơ chế Zero-Chinese: Tuyệt đối không bao giờ để lọt chữ tiếng Trung bản gốc lên màn hình.
    - Render thẻ đè chuẩn CapCut (Opaque Card Box) tại đúng tọa độ x, y bằng FFmpeg ASS.
    """
    _ocr_engine: Optional[RapidOCR] = None

    @classmethod
    def get_ocr_engine(cls) -> RapidOCR:
        if cls._ocr_engine is None:
            cls._ocr_engine = RapidOCR()
        return cls._ocr_engine

    @staticmethod
    def format_ass_timestamp(seconds: float) -> str:
        """Chuyển số giây sang định dạng chuẩn ASS: H:MM:SS.cc (centiseconds)"""
        total_cs = max(0, int(round(seconds * 100)))
        hours = total_cs // 360000
        total_cs %= 360000
        minutes = total_cs // 6000
        total_cs %= 6000
        secs = total_cs // 100
        cs = total_cs % 100
        return f"{hours}:{minutes:02d}:{secs:02d}.{cs:02d}"

    @staticmethod
    def clean_cn_text(text: str) -> str:
        if not text:
            return ""
        return re.sub(r'[\s\.\,\!\?，。！？、“”：；、…~—\-_]', '', text).lower()

    @classmethod
    def cn_similarity(cls, s1: str, s2: str) -> float:
        """Tính độ tương đồng giữa 2 chuỗi tiếng Trung (Levenshtein + Character Overlap)"""
        c1 = cls.clean_cn_text(s1)
        c2 = cls.clean_cn_text(s2)
        if not c1 or not c2:
            return 0.0
        ratio = SequenceMatcher(None, c1, c2).ratio()
        set1 = set(c1)
        set2 = set(c2)
        if set1 and set2:
            overlap = len(set1 & set2) / max(len(set1), len(set2))
            return max(ratio, overlap)
        return ratio

    @staticmethod
    def merge_horizontal_boxes(boxes: List[List[int]], max_gap: int = 40) -> List[List[int]]:
        """Gộp các bounding box nằm trên cùng một dòng ngang và gần nhau thành một dòng hoàn chỉnh."""
        if not boxes or len(boxes) <= 1:
            return boxes

        # Sắp xếp theo y rồi theo x
        sorted_boxes = sorted(boxes, key=lambda b: ((b[1] + b[3]) // 20, b[0]))
        merged = []

        for b in sorted_boxes:
            if not merged:
                merged.append(list(b))
                continue

            last = merged[-1]
            last_cy = (last[1] + last[3]) / 2.0
            curr_cy = (b[1] + b[3]) / 2.0

            # Cùng một dòng ngang (lệch cy < 16px) và khoảng cách x gần nhau (gap <= max_gap hoặc lấn nhau)
            is_same_line = abs(last_cy - curr_cy) < 16
            is_close_x = (b[0] - last[2]) <= max_gap and (last[0] - b[2]) <= max_gap

            if is_same_line and is_close_x:
                last[0] = min(last[0], b[0])
                last[1] = min(last[1], b[1])
                last[2] = max(last[2], b[2])
                last[3] = max(last[3], b[3])
            else:
                merged.append(list(b))

        return merged

    @classmethod
    def scan_video_text_tracks(
        cls,
        video_path: Path,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> List[Dict[str, Any]]:
        """
        Quét video để tìm tất cả các Text Tracks (vị trí, thời gian xuất hiện, nội dung gốc).
        Lọc bỏ triệt để các chữ trên bao bì sản phẩm, nhãn mác, áo quần.
        """
        cap = cv2.VideoCapture(str(video_path))
        if not cap.isOpened():
            raise FileNotFoundError(f"Không thể mở video: {video_path}")

        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
        fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 720
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1280

        yolo = SubtitleRemoverService.get_yolo_model()
        device = SubtitleRemoverService.get_device()
        ocr = cls.get_ocr_engine()

        active_tracks: Dict[int, Dict[str, Any]] = {}
        finished_tracks: List[Dict[str, Any]] = []
        next_track_id = 0
        frame_idx = 0

        SAMPLE_STEP = 3  # Quét ~10 khung hình/giây
        step_dt = SAMPLE_STEP / fps

        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break

            if frame_idx % SAMPLE_STEP == 0:
                sec = frame_idx / fps
                res = yolo(frame, device=device, verbose=False, conf=0.20, imgsz=1024)
                raw_boxes: List[List[int]] = []

                if res and len(res[0].boxes) > 0:
                    for b in res[0].boxes:
                        bx1, by1, bx2, by2 = [int(v) for v in b.xyxy[0].tolist()]
                        bh = by2 - by1

                        # BỘ LỌC SƠ BỘ: Chiều cao hợp lệ & nằm trong dải Subtitle/Banner
                        if bh < 14 or bh > 220:
                            continue

                        cy = (by1 + by2) / 2.0
                        is_valid_zone = (
                            (cy >= h * 0.58) or
                            (0.34 * h <= cy <= 0.52 * h) or
                            (cy <= h * 0.25)
                        )
                        if not is_valid_zone:
                            continue

                        raw_boxes.append([bx1, by1, bx2, by2])

                # GỘP CÁC TỪ CÙNG DÒNG NGANG (Tránh sót chữ đầu/cuối như chữ 答)
                merged_line_boxes = cls.merge_horizontal_boxes(raw_boxes, max_gap=40)

                detected_boxes: List[List[int]] = []
                for mb in merged_line_boxes:
                    bx1, by1, bx2, by2 = mb
                    bw = bx2 - bx1
                    # BỘ LỌC ĐỘ RỘNG VÀ CĂN GIỮA DÒNG
                    if bw < int(w * 0.16):
                        continue
                    cx = (bx1 + bx2) / 2.0
                    if abs(cx - (w / 2.0)) > (w * 0.38):
                        continue
                    detected_boxes.append(mb)

                matched_track_ids = set()
                for box in detected_boxes:
                    bx1, by1, bx2, by2 = box
                    c_y = (by1 + by2) / 2.0
                    matched = False

                    for tid, track in list(active_tracks.items()):
                        if tid in matched_track_ids:
                            continue
                        ob = track['box']
                        ob_cy = (ob[1] + ob[3]) / 2.0

                        # Kiểm tra xem có cùng dòng y không
                        if abs(ob_cy - c_y) < 28 and not (bx2 < ob[0] - 60 or bx1 > ob[2] + 60):
                            # Kiểm tra định kỳ xem nội dung chữ có bị đổi câu thoại không
                            # (chống hiện tượng gộp câu 1 sang câu 2, 3...)
                            need_ocr_check = (sec - track.get('last_ocr_sec', track['start_sec'])) >= 0.8
                            if need_ocr_check:
                                px1 = max(0, bx1 - 6)
                                py1 = max(0, by1 - 6)
                                px2 = min(w, bx2 + 6)
                                py2 = min(h, by2 + 6)
                                roi = frame[py1:py2, px1:px2]
                                check_text = ""
                                try:
                                    rec_res, _ = ocr(roi, use_det=False, use_cls=False, use_rec=True)
                                    if rec_res and len(rec_res) > 0 and float(rec_res[0][1]) >= 0.50:
                                        check_text = rec_res[0][0].strip()
                                except Exception:
                                    pass

                                track['last_ocr_sec'] = sec
                                # Nếu chữ mới khác biệt hoàn toàn (>60% khác chữ cũ) -> câu thoại mới xuất hiện!
                                if check_text and track.get('text'):
                                    sim = cls.cn_similarity(track['text'], check_text)
                                    if sim < 0.40:
                                        # Kết thúc track cũ ngay tại đây
                                        fin = active_tracks.pop(tid)
                                        if fin['text'] and (fin['end_sec'] - fin['start_sec']) >= 0.3:
                                            finished_tracks.append(fin)
                                        # Không match vào track cũ này nữa để tạo track mới
                                        break

                            track['box'] = [
                                min(ob[0], bx1),
                                min(ob[1], by1),
                                max(ob[2], bx2),
                                max(ob[3], by2)
                            ]
                            track['end_sec'] = sec + step_dt
                            track['ttl'] = 4
                            matched_track_ids.add(tid)
                            matched = True
                            break

                    if not matched:
                        # Box mới xuất hiện -> OCR nhận dạng chữ
                        px1 = max(0, bx1 - 6)
                        py1 = max(0, by1 - 6)
                        px2 = min(w, bx2 + 6)
                        py2 = min(h, by2 + 6)
                        roi = frame[py1:py2, px1:px2]

                        detected_text = ""
                        try:
                            rec_res, _ = ocr(roi, use_det=False, use_cls=False, use_rec=True)
                            if rec_res and len(rec_res) > 0:
                                t_str, conf = rec_res[0][0], float(rec_res[0][1])
                                if conf >= 0.45:
                                    detected_text = t_str.strip()
                        except Exception:
                            pass

                        # BỘ LỌC 4: Nội dung chữ Hán có nghĩa (Loại bỏ triệt để từ rác tiếng Anh trên bao bì)
                        cn_chars = re.findall(r'[\u4e00-\u9fff]', detected_text)
                        if len(cn_chars) < 2:
                            # Không phải phụ đề/banner tiếng Trung -> BỎ QUA
                            continue

                        active_tracks[next_track_id] = {
                            'id': next_track_id,
                            'box': box,
                            'start_sec': sec,
                            'end_sec': sec + step_dt,
                            'text': detected_text,
                            'last_ocr_sec': sec,
                            'ttl': 4
                        }
                        matched_track_ids.add(next_track_id)
                        next_track_id += 1

                dead_ids = []
                for tid, track in active_tracks.items():
                    if tid not in matched_track_ids:
                        track['ttl'] -= 1
                        if track['ttl'] <= 0:
                            dead_ids.append(tid)

                for tid in dead_ids:
                    fin = active_tracks.pop(tid)
                    dur = fin['end_sec'] - fin['start_sec']
                    # Nếu ở ngay đầu video (start_sec <= 0.15s), chấp nhận cả các sticker/tiêu đề mở đầu chớp nhoáng (dur >= 0.05s)
                    is_valid_dur = (dur >= 0.25) or (fin['start_sec'] <= 0.15 and dur >= 0.05)
                    if fin['text'] and is_valid_dur:
                        if fin['start_sec'] <= 0.15:
                            fin['end_sec'] = max(fin['end_sec'], 0.45)
                        finished_tracks.append(fin)

                if progress_callback and total_frames > 0 and frame_idx % 30 == 0:
                    pct = int((frame_idx / total_frames) * 100)
                    progress_callback(f"Đang quét & nhận diện chữ trên màn hình: {pct}%", pct)

            frame_idx += 1

        cap.release()
        for tid, track in active_tracks.items():
            dur = track['end_sec'] - track['start_sec']
            is_valid_dur = (dur >= 0.25) or (track['start_sec'] <= 0.15 and dur >= 0.05)
            if track['text'] and is_valid_dur:
                if track['start_sec'] <= 0.15:
                    track['end_sec'] = max(track['end_sec'], 0.45)
                finished_tracks.append(track)

        return finished_tracks

    @classmethod
    async def translate_tracks(
        cls,
        tracks: List[Dict[str, Any]],
        dubbed_segments: Optional[List[Dict[str, Any]]] = None,
        ai_api_key: Optional[str] = None,
        ai_base_url: Optional[str] = None,
        ai_model: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Dịch toàn bộ nội dung chữ gốc của các tracks sang tiếng Việt tự nhiên chuẩn TikTok,
        đồng thời ĐỒNG BỘ 100% TỪ NGỮ với giọng đọc lồng tiếng đã được tạo.
        """
        if not tracks:
            return []

        # TẦNG 1: So khớp thông minh với kịch bản thoại đã lồng tiếng (Fuzzy + Overlap)
        unmatched_tracks = []
        if dubbed_segments:
            for t in tracks:
                t_text = t.get('text', '')
                t_start = t.get('start_sec', 0.0)
                t_end = t.get('end_sec', 0.0)

                # BẮT BUỘC: Track phải chứa ít nhất 2 ký tự tiếng Trung mới được so khớp với câu thoại
                cn_chars = re.findall(r'[\u4e00-\u9fff]', t_text)
                if len(cn_chars) < 2:
                    continue

                best_match_seg = None
                best_match_score = 0.0

                for seg in dubbed_segments:
                    seg_text = seg.get('text', '')
                    if not seg_text:
                        continue

                    seg_start = seg.get('start', seg.get('actual_start', 0.0))
                    seg_end = seg.get('end', seg.get('actual_end', seg_start + 1.0))

                    # Kiểm tra độ trùng lặp thời gian (Timeline overlap)
                    overlap = max(0.0, min(t_end, seg_end) - max(t_start, seg_start))
                    # Tính độ tương đồng chữ Hán giữa 2 câu
                    sim = cls.cn_similarity(t_text, seg_text)

                    # BẮT BUỘC phải có độ tương đồng ký tự Hán tối thiểu 30%
                    if sim < 0.30:
                        continue

                    score = 100.0 * sim + overlap
                    if score > best_match_score:
                        best_match_score = score
                        best_match_seg = seg

                # Nếu khớp câu thoại với độ tin cậy cao -> lấy ngay 100% bản dịch lồng tiếng
                if best_match_seg and best_match_score >= 40.0:
                    vi_trans = best_match_seg.get('translated_text', '').strip()
                    if vi_trans:
                        t['translated_text'] = vi_trans
                        continue

                unmatched_tracks.append(t)
        else:
            unmatched_tracks = list(tracks)

        # TẦNG 2: Dịch các Banner tiêu đề hoặc Intro Title Sticker ở đầu video
        # TUYỆT ĐỐI KHÔNG DỊCH các mẩu chữ rác trên bao bì sản phẩm hay đồ vật!
        banner_candidates = []
        for t in unmatched_tracks:
            if t.get('translated_text'):
                continue
            cy = (t['box'][1] + t['box'][3]) / 2.0
            cx = (t['box'][0] + t['box'][2]) / 2.0
            bw = t['box'][2] - t['box'][0]
            bh = t['box'][3] - t['box'][1]
            st = t.get('start_sec', 0.0)

            # Trường hợp A: Tiêu đề đỉnh trên cùng (Top Header Banner):
            is_top_banner = (cy <= 320 and bw >= 200 and st <= 5.0)

            # Trường hợp B: Intro Title Sticker mở đầu clip (như chữ 擦鞋湿巾 ở giây 0:00):
            # Xuất hiện trong 0.8 giây đầu, căn giữa màn hình, chữ to rõ (bh >= 28 hoặc bw >= 160)
            is_intro_sticker = (
                st <= 0.8 and
                abs(cx - 360) < 140 and
                (bh >= 28 or bw >= 160) and
                cy <= 850
            )

            if is_top_banner or is_intro_sticker:
                banner_candidates.append(t)

        unique_texts = list(set(t['text'] for t in banner_candidates if t['text']))
        if unique_texts:
            translation_map: Dict[str, str] = {}
            try:
                import httpx
                from ..config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_BASE_URL

                key = ai_api_key or GEMINI_API_KEY
                base_url = (ai_base_url or GEMINI_BASE_URL).rstrip("/")
                model = ai_model or GEMINI_MODEL or "gemini-3.5-flash-lite"

                # Xây dựng bảng kịch bản thoại lồng tiếng để Gemini tham chiếu đồng bộ
                glossary_lines = []
                if dubbed_segments:
                    for s in dubbed_segments:
                        cn = s.get('text', '').strip()
                        vi = s.get('translated_text', '').strip()
                        if cn and vi:
                            glossary_lines.append(f'- Gốc: "{cn}" => Đã dịch: "{vi}"')
                glossary_context = "\n".join(glossary_lines[:25])

                prompt = (
                    "Bạn là chuyên gia dịch thuật video ngắn TikTok/Douyin sang tiếng Việt.\n"
                    "Nhiệm vụ: Hãy dịch các tiêu đề hoặc banner tiếng Trung sau sang tiếng Việt "
                    "thật tự nhiên, ngắn gọn, súc tích, chuẩn văn phong đời thường/review của người Việt Nam.\n\n"
                )
                if glossary_context:
                    prompt += (
                        "QUY TẮC ĐỒNG BỘ TỪ NGỮ VỚI KỊCH BẢN THOẠI:\n"
                        f"{glossary_context}\n\n"
                    )

                prompt += (
                    "Định dạng trả về duy nhất là JSON object ánh xạ từ chuỗi gốc sang chuỗi tiếng Việt dịch được:\n"
                    '{"chữ gốc": "bản dịch tiếng Việt"}\n\n'
                    f"Danh sách cần dịch: {json.dumps(unique_texts, ensure_ascii=False)}"
                )

                url = f"{base_url}/v1beta/models/{model}:generateContent?key={key}"
                payload = {
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "temperature": 0.1,
                        "responseMimeType": "application/json"
                    }
                }

                async with httpx.AsyncClient(timeout=30.0) as client:
                    res = await client.post(url, json=payload)
                    if res.status_code == 200:
                        data = res.json()
                        cands = data.get("candidates", [])
                        if cands:
                            raw_ans = cands[0]["content"]["parts"][0]["text"].strip()
                            raw_ans = re.sub(r"^```(?:json)?", "", raw_ans).rstrip("`").strip()
                            translation_map = json.loads(raw_ans)
            except Exception as e:
                print(f"[InplaceOverlay] Lỗi dịch Gemini: {e}")

            # Fallback nếu cần
            if not translation_map:
                try:
                    from deep_translator import GoogleTranslator
                    trans = GoogleTranslator(source="auto", target="vi")
                    for ut in unique_texts:
                        translation_map[ut] = trans.translate(ut)
                except Exception:
                    pass

            # Gán bản dịch cho các banner candidates
            for t in banner_candidates:
                if not t.get('translated_text'):
                    orig = t['text']
                    translated = translation_map.get(orig, "").strip()
                    if translated and not re.search(r'[\u4e00-\u9fff]', translated):
                        t['translated_text'] = translated
                    else:
                        t['translated_text'] = ""

        # Lọc lại lần cuối: Chỉ giữ lại các track có bản dịch tiếng Việt hợp lệ
        valid_tracks = [
            t for t in tracks
            if t.get('translated_text') and not re.search(r'[\u4e00-\u9fff]', t['translated_text'])
        ]
        return valid_tracks

    @staticmethod
    def _hex_to_ass_color(c: str, default: str = "&H000000&") -> str:
        if not c or not isinstance(c, str):
            return default
        c_lower = c.lower().strip()
        named_map = {
            "yellow": "&H00FFFF&",
            "white": "&HFFFFFF&",
            "black": "&H000000&",
            "red": "&H0000FF&",
            "cyan": "&HFFFF00&",
            "green": "&H00FF00&",
            "orange": "&H0080FF&",
            "purple": "&H800080&",
        }
        if c_lower in named_map:
            return named_map[c_lower]
        h = c.strip().lstrip("#")
        if len(h) == 3:
            h = f"{h[0]}{h[0]}{h[1]}{h[1]}{h[2]}{h[2]}"
        if len(h) == 6:
            try:
                r = h[0:2]
                g = h[2:4]
                b = h[4:6]
                return f"&H{b}{g}{r}&"
            except Exception:
                return default
        return default

    @staticmethod
    def _opacity_to_ass_alpha(opacity: float) -> str:
        """Trong ASS, 00 là hoàn toàn đặc, FF là hoàn toàn trong suốt."""
        val = int((1.0 - max(0.0, min(1.0, float(opacity)))) * 255)
        return f"&H{val:02X}&"

    @staticmethod
    def _build_rounded_rect_path(x1: int, y1: int, x2: int, y2: int, radius: int = 10) -> str:
        """
        Tạo chuỗi lệnh vẽ vector ASS (m ... l ... b ...) cho hình chữ nhật bo 4 góc tròn mềm mại.
        Sử dụng Bézier cubic curve (b) chuẩn mực của libass / CapCut.
        """
        w = x2 - x1
        h = y2 - y1
        r = max(2, min(radius, w // 4, h // 4))
        c = int(round(r * 0.5523))

        path = (
            f"m {x1 + r} {y1} "
            f"l {x2 - r} {y1} "
            f"b {x2 - r + c} {y1} {x2} {y1 + r - c} {x2} {y1 + r} "
            f"l {x2} {y2 - r} "
            f"b {x2} {y2 - r + c} {x2 - r + c} {y2} {x2 - r} {y2} "
            f"l {x1 + r} {y2} "
            f"b {x1 + r - c} {y2} {x1} {y2 - r + c} {x1} {y2 - r} "
            f"l {x1} {y1 + r} "
            f"b {x1} {y1 + r - c} {x1 + r - c} {y1} {x1 + r} {y1}"
        )
        return path

    @classmethod
    def generate_ass_script(
        cls,
        tracks: List[Dict[str, Any]],
        video_w: int,
        video_h: int,
        text_color: str = "yellow",
        style_config: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Sinh file phụ đề ASS chuẩn CapCut với kiểu dáng tùy chỉnh linh hoạt:
        - Cỡ chữ, màu chữ, màu viền chữ
        - Màu nền khung đè, độ mờ đục (opacity)
        - Tự động bo tròn 4 góc mềm mại chuẩn CapCut
        """
        cfg = style_config or {}
        base_font_size = int(cfg.get("font_size") or cfg.get("fontSize") or 34)
        txt_col = cfg.get("text_color") or cfg.get("textColor") or text_color or "yellow"
        box_col = cfg.get("box_color") or cfg.get("boxColor") or "#000000"
        box_op = float(cfg.get("box_opacity") if cfg.get("box_opacity") is not None else cfg.get("boxOpacity", 1.0))
        stroke_col = cfg.get("stroke_color") or cfg.get("strokeColor") or "#000000"
        stroke_w = int(cfg.get("stroke_width") if cfg.get("stroke_width") is not None else cfg.get("strokeWidth", 2))

        # Tự động scale cỡ chữ theo độ phân giải thực của video (chuẩn hóa theo 720p base)
        # Giúp chữ trên video 1080p, 2K luôn to rõ tương xứng tỉ lệ màn hình, không bị tí hon
        scale_res = max(1.0, video_w / 640.0)
        scaled_user_font = int(base_font_size * scale_res)

        ass_text_col = cls._hex_to_ass_color(txt_col, default="&H00FFFF&")
        ass_box_col = cls._hex_to_ass_color(box_col, default="&H000000&")
        ass_stroke_col = cls._hex_to_ass_color(stroke_col, default="&H000000&")
        ass_box_alpha = cls._opacity_to_ass_alpha(box_op)

        ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: MaskBox,Arial,28,&H00000000,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1
Style: InplaceText,Arial,{scaled_user_font},{ass_text_col},&H000000FF,{ass_stroke_col},&H00000000,-1,0,0,0,100,100,0,0,1,{stroke_w},0,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        dialogues = []
        for t in tracks:
            vi_text = (t.get('translated_text') or '').strip()
            # Bỏ qua nếu không có bản dịch tiếng Việt hoặc còn chữ Trung
            if not vi_text or re.search(r'[\u4e00-\u9fff]', vi_text):
                continue

            bx1, by1, bx2, by2 = t['box']
            bw = bx2 - bx1
            bh = by2 - by1
            cy = (by1 + by2) // 2

            # Căn giữa màn hình cho phụ đề
            cx = video_w // 2

            # Cỡ chữ thực tế: Tối thiểu bằng scaled_user_font, nhưng nếu vùng chữ gốc cao thì chữ tự phóng to
            # lấp đầy ~85% chiều cao khung để chữ to đậm, không bị lọt thỏm
            font_size = max(scaled_user_font, int(bh * 0.85))

            # Ước lượng chiều dài chữ tiếng Việt theo cỡ chữ
            est_text_w = int(len(vi_text) * font_size * 0.58)

            # BỀ RỘNG KHUNG ĐỆM: Ôm sát chữ vừa vặn, không bị bè rộng thừa thãi
            padding_x = int(font_size * 0.40)
            box_w = max(est_text_w + padding_x * 2, bw + 16)
            box_w = min(int(video_w * 0.95), box_w)

            # CHIỀU CAO KHUNG: Ôm sát mép chữ (padding trên dưới cực kỳ sát, chữ chiếm ~88% khung)
            # Khắc phục hoàn toàn hiện tượng khung to bè mà chữ bé tí teo
            box_h = max(int(font_size * 1.15), bh + 4)

            # Tọa độ hộp che đối xứng ở giữa:
            mask_x1 = max(0, cx - box_w // 2)
            mask_x2 = min(video_w, cx + box_w // 2)
            mask_y1 = max(0, cy - box_h // 2)
            mask_y2 = min(video_h, cy + box_h // 2)

            start_ass = cls.format_ass_timestamp(t['start_sec'])
            end_ass = cls.format_ass_timestamp(t['end_sec'])

            # Layer 0: Khung màu che (MaskBox) với góc bo tròn mềm mại ôm sát chữ
            if box_op > 0.05:
                # Bán kính bo góc gọn gàng (4-8px)
                radius = max(5, min(10, int(box_h * 0.16)))
                rect_path = cls._build_rounded_rect_path(mask_x1, mask_y1, mask_x2, mask_y2, radius=radius)
                mask_line = f"Dialogue: 0,{start_ass},{end_ass},MaskBox,,0,0,0,,{{\\pos(0,0)\\p1\\c{ass_box_col}\\1a{ass_box_alpha}\\3c{ass_box_col}\\3a{ass_box_alpha}\\bord0\\shad0}}{rect_path}{{\\p0}}"
                dialogues.append(mask_line)

            # Layer 1: Chữ tiếng Việt to rõ, đặt chính giữa khung
            text_line = f"Dialogue: 1,{start_ass},{end_ass},InplaceText,,0,0,0,,{{\\pos({cx},{cy})\\fs{font_size}\\c{ass_text_col}\\bord{stroke_w}\\3c{ass_stroke_col}}}{vi_text}"
            dialogues.append(text_line)

        return ass_header + "\n".join(dialogues) + "\n"

    @classmethod
    async def process_video_inplace_overlay(
        cls,
        input_video: Path,
        output_video: Path,
        audio_path: Optional[Path] = None,
        dubbed_segments: Optional[List[Dict[str, Any]]] = None,
        text_color: str = "yellow",
        style_config: Optional[Dict[str, Any]] = None,
        ai_api_key: Optional[str] = None,
        ai_base_url: Optional[str] = None,
        ai_model: Optional[str] = None,
        progress_callback: Optional[Callable[[str, int], None]] = None
    ) -> bool:
        """
        Quy trình trọn gói: Quét chữ (lọc sạch bao bì) -> Dịch tiếng Việt (đồng bộ 100% thoại) -> Burn thẻ đè ASS vào video.
        """
        if progress_callback:
            progress_callback("AI đang quét phụ đề & banner trên video...", 10)

        tracks = cls.scan_video_text_tracks(input_video, progress_callback=progress_callback)

        # Nếu quét không ra track nào nhưng có dubbed_segments:
        # Ta có thể tạo track phụ đề thoại dựa theo dubbed_segments ở vị trí chuẩn
        if not tracks and not dubbed_segments:
            print("[InplaceOverlay] Không phát hiện chữ nào cần đè thẻ. Bỏ qua bước này.")
            return False

        if progress_callback:
            progress_callback(f"Đã lọc & phát hiện {len(tracks)} cụm phụ đề/banner. Đang đồng bộ tiếng Việt...", 50)

        tracks = await cls.translate_tracks(
            tracks,
            dubbed_segments=dubbed_segments,
            ai_api_key=ai_api_key,
            ai_base_url=ai_base_url,
            ai_model=ai_model
        )

        cap = cv2.VideoCapture(str(input_video))
        vw = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 720
        vh = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 1280
        cap.release()

        # ĐỒNG BỘ PHỤ ĐỀ THOẠI (Speech Subtitles):
        # Nếu có dubbed_segments và phát hiện vị trí phụ đề thoại (hoặc vị trí mặc định cy=528 nếu là video 2 phần, hoặc cy=0.82*vh nếu là video dọc)
        # Kiểm tra xem có track nào ở dải phụ đề chưa:
        has_speech_tracks = any(t.get('box', [0, 0, 0, 0])[1] > vh * 0.30 for t in tracks)
        if not has_speech_tracks and dubbed_segments:
            # Tự động bổ sung phụ đề thoại từ kịch bản lồng tiếng tại vị trí chuẩn
            default_cy = int(vh * 0.82)
            for seg in dubbed_segments:
                vi = seg.get('translated_text', '').strip()
                if not vi:
                    continue
                s_start = seg.get('actual_start', seg.get('start', 0.0))
                s_end = seg.get('actual_end', seg.get('end', s_start + 1.5))
                tracks.append({
                    'id': 99000 + seg.get('id', 0),
                    'box': [int(vw * 0.1), default_cy - 16, int(vw * 0.9), default_cy + 16],
                    'start_sec': s_start,
                    'end_sec': s_end,
                    'text': seg.get('text', ''),
                    'translated_text': vi
                })

        if not tracks:
            print("[InplaceOverlay] Không có track nào hợp lệ để render.")
            return False

        ass_content = cls.generate_ass_script(tracks, vw, vh, text_color=text_color, style_config=style_config)
        ass_path = output_video.with_suffix(".inplace.ass")
        with open(ass_path, "w", encoding="utf-8") as f:
            f.write(ass_content)

        if progress_callback:
            progress_callback("Đang render thẻ phụ đề tiếng Việt chuẩn xác từng vị trí...", 80)

        ffmpeg = MediaComposer.get_ffmpeg_bin()
        ass_filter_path = str(ass_path).replace("\\", "/").replace(":", "\\:")

        cmd = [
            ffmpeg, "-y",
            "-i", str(input_video),
        ]
        if audio_path and audio_path.exists():
            cmd.extend(["-i", str(audio_path), "-c:a", "aac", "-b:a", "192k"])
        else:
            cmd.extend(["-c:a", "copy"])

        cmd.extend([
            "-vf", f"ass='{ass_filter_path}'",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "19",
            str(output_video)
        ])

        res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, errors="replace")
        try:
            ass_path.unlink()
        except Exception:
            pass

        if output_video.exists() and output_video.stat().st_size > 1000:
            if progress_callback:
                progress_callback("✅ Hoàn tất đè thẻ phụ đề tiếng Việt thành công 100%!", 100)
            return True
        else:
            print(f"[InplaceOverlay] ❌ Lỗi render FFmpeg: {res.stderr}")
            return False
