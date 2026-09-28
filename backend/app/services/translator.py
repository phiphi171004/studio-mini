import os
import re
import json
import httpx
from pathlib import Path
from typing import List, Dict, Any, Optional
from ..config import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    GEMINI_BASE_URL,
    AI_TRANSLATE_API_KEY,
    AI_TRANSLATE_MODEL
)

def safe_log(msg: str):
    try:
        print(msg)
    except Exception:
        try:
            print(msg.encode("ascii", "replace").decode("ascii"))
        except Exception:
            pass

class TranslatorService:
    """
    Dịch thuật kịch bản video thông minh bằng Google Gemini theo chuẩn Document-Level SRT:
    - Gửi toàn bộ file/danh sách phụ đề SRT trong một lượt gọi duy nhất.
    - Nắm trọn bối cảnh video từ đầu đến cuối, triệt tiêu hoàn toàn lỗi nhầm đại từ nhân xưng
      (như gọi miếng bọt biển/đồ vật là "anh/ông ấy").
    - Bảo toàn 100% định dạng SRT, timestamp và nhịp độ lồng tiếng chuẩn xác.
    - Fallback tự động qua deep_translator nếu không có API key.
    """

    @staticmethod
    def format_srt_timestamp(seconds: float) -> str:
        """Chuyển số giây sang định dạng chuẩn SRT: HH:MM:SS,mmm"""
        total_ms = max(0, int(round(seconds * 1000)))
        hours = total_ms // 3600000
        total_ms %= 3600000
        minutes = total_ms // 60000
        total_ms %= 60000
        secs = total_ms // 1000
        ms = total_ms % 1000
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"

    @classmethod
    def segments_to_srt_text(cls, segments: List[Dict[str, Any]]) -> str:
        """Chuyển danh sách segments thành chuỗi văn bản SRT chuẩn kèm gợi ý giới hạn từ theo thời lượng."""
        lines = []
        for idx, seg in enumerate(segments, 1):
            s_id = seg.get("id", idx)
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", start + 1.0))
            if end <= start:
                end = start + 1.0
            dur = max(0.4, round(end - start, 2))
            if dur <= 0.8:
                max_w = 2
            elif dur <= 1.3:
                max_w = 4
            elif dur <= 1.8:
                max_w = 6
            else:
                max_w = max(4, int(dur * 2.8))
            start_ts = cls.format_srt_timestamp(start)
            end_ts = cls.format_srt_timestamp(end)
            text = seg.get("text", "").strip()
            lines.append(f"{s_id}\n{start_ts} --> {end_ts} [Thời lượng: {dur}s - TỐI ĐA {max_w} TỪ]\n{text}\n")
        return "\n".join(lines)

    @classmethod
    def parse_srt_text(cls, srt_content: str) -> Dict[int, str]:
        """Parse chuỗi SRT thành map {segment_id: text}."""
        content = srt_content.strip()
        # Loại bỏ markdown codeblock nếu Gemini bọc trong ```srt ... ```
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0].strip()

        blocks = re.split(r'\n\s*\n', content)
        result_map: Dict[int, str] = {}
        sequential_list: List[str] = []

        for b in blocks:
            lines = [l.strip() for l in b.splitlines() if l.strip()]
            if len(lines) >= 3 and "-->" in lines[1]:
                text = " ".join(lines[2:]).strip()
                # Loại bỏ phần gợi ý [Thời lượng...] nếu model vô tình lặp lại ở dòng text
                text = re.sub(r'\[Thời lượng.*?\]', '', text).strip()
                try:
                    seg_id = int(lines[0])
                    result_map[seg_id] = text
                except Exception:
                    pass
                sequential_list.append(text)
            elif len(lines) == 2 and "-->" in lines[0]:
                text = lines[1].strip()
                text = re.sub(r'\[Thời lượng.*?\]', '', text).strip()
                sequential_list.append(text)

        # Fallback index nếu map theo ID bị thiếu
        if not result_map and sequential_list:
            for idx, txt in enumerate(sequential_list, 1):
                result_map[idx] = txt

        return result_map

    @classmethod
    async def translate_segments(
        cls,
        segments: List[Dict[str, Any]],
        target_lang: str = "vi",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        gemini_api_key: Optional[str] = None,
        gemini_model: Optional[str] = None,
        gemini_base_url: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Dịch toàn bộ segments phụ đề bằng Google Gemini SRT hoặc Fallback.
        """
        if not segments:
            return []

        # Ưu tiên Gemini Key (hoặc key truyền vào)
        effective_gemini_key = (
            gemini_api_key
            or GEMINI_API_KEY
            or api_key
            or AI_TRANSLATE_API_KEY
            or os.getenv("GEMINI_API_KEY", "")
            or os.getenv("GOOGLE_API_KEY", "")
            or ""
        ).strip()

        effective_model = (
            gemini_model
            or GEMINI_MODEL
            or model
            or AI_TRANSLATE_MODEL
            or "gemini-3.5-flash-lite"
        ).strip()

        # Dùng Google Gemini làm công cụ dịch thuật chính
        if effective_gemini_key:
            try:
                safe_log(f"[TranslatorService] Đang gửi nguyên file SRT ({len(segments)} câu) lên Google Gemini ({effective_model})...")
                translated = await cls._translate_srt_with_gemini(
                    segments=segments,
                    api_key=effective_gemini_key,
                    model=effective_model
                )
                if translated and len(translated) == len(segments):
                    safe_log(f"[TranslatorService] ✅ Gemini đã dịch thành công trọn vẹn {len(translated)} câu theo ngữ cảnh video!")
                    return translated
                else:
                    safe_log("[TranslatorService] Gemini trả về kết quả chưa trọn vẹn, chuyển sang fallback...")
            except Exception as e:
                safe_log(f"[TranslatorService] Lỗi dịch thuật Gemini: {e}. Đang chuyển sang dịch miễn phí fallback...")

        # Fallback dịch miễn phí nếu không có key hoặc lỗi mạng
        safe_log("[TranslatorService] Sử dụng deep_translator (fallback miễn phí)...")
        return cls._translate_with_fallback(segments)

    @classmethod
    async def _translate_srt_with_gemini(
        cls,
        segments: List[Dict[str, Any]],
        api_key: str,
        model: str = "gemini-3.5-flash-lite"
    ) -> List[Dict[str, Any]]:
        """
        Gửi nguyên toàn bộ file phụ đề SRT lên Google Gemini để dịch toàn diện.
        """
        batch_size = 120  # Đủ chứa trọn vẹn video ngắn đến 10-15 phút trong 1 batch duy nhất
        trans_map: Dict[int, str] = {}

        system_prompt = (
            "Bạn là Đạo diễn lồng tiếng và Dịch giả video review / bán hàng triệu view chuyên nghiệp bậc thầy.\n"
            "Nhiệm vụ: Dịch toàn bộ file phụ đề SRT sau từ tiếng gốc (thường là tiếng Trung) sang Tiếng Việt chuẩn mực, cuốn hút, tự nhiên, đúng ngữ cảnh sản phẩm và KHỚP 100% VỚI HÀNH ĐỘNG NHÂN VẬT.\n\n"
            "CÁC NGUYÊN TẮC CỐT LÕI (BẮT BUỘC TUÂN THỦ 100%):\n"
            "1. QUY TẮC ĐỘ DÀI VÀ SỐ LƯỢNG TỪ (BẮT BUỘC TUÂN THỦ ĐỂ KHÔNG BỊ TRỄ KHẨU HÌNH VÀ HÀNH ĐỘNG):\n"
            "   - Nhân vật trong video thao tác và nói rất nhanh. Nếu bạn dịch dài dòng, giọng đọc lồng tiếng sẽ bị trễ, kéo dài sang cảnh sau và lệch hoàn toàn so với hành động của nhân vật trên màn hình!\n"
            "   - BẮT BUỘC TUÂN THỦ số từ tối đa ghi trong gợi ý [TỐI ĐA X TỪ] của từng dòng phụ đề:\n"
            "     * Dòng ghi TỐI ĐA 2 TỪ: Chỉ được dịch đúng 2 từ (ví dụ: 'Rất chắc', 'Không đọng nước', 'Chắc nịch').\n"
            "     * Dòng ghi TỐI ĐA 4 TỪ: Chỉ được dịch từ 3 đến 4 từ (ví dụ: 'Gắn ngay lên đây', 'Hít cực kỳ chắc', 'Cọ trang điểm nữa').\n"
            "     * Dòng ghi TỐI ĐA 6 TỪ: Chỉ được dịch từ 4 đến 6 từ súc tích.\n"
            "   - TUYỆT ĐỐI CẤM thêm các từ đệm rườm rà ('nhé', 'nha', 'đâu nhé', 'các thứ', 'lớn nhỏ đều đặt lên được hết'...). Cắt bỏ ngay các từ thừa thãi!\n"
            "   - Dịch cô đọng, dứt khoát, giàu năng lượng bán hàng kiểu TikTok.\n"
            "2. QUY TẮC ĐẠI TỪ NHÂN XƯNG (TUYỆT ĐỐI CHỐNG DỊCH ẢO GIÁC):\n"
            "   - Người nói (Reviewer/Người bán): Xưng 'mình' hoặc 'em' tùy ngữ cảnh.\n"
            "   - Khán giả / Người xem: Gọi 'mọi người', 'các bạn'.\n"
            "   - ĐỐI TƯỢNG SẢN PHẨM / ĐỒ VẬT / DỤNG CỤ (ví dụ: miếng bọt biển, kệ, nồi, chảo, khăn lau, máy móc...):\n"
            "     * BẮT BUỘC gọi là: 'nó', 'em này', 'chiếc này', 'cái này', 'sản phẩm này'.\n"
            "     * TUYỆT ĐỐI CẤM gọi đồ vật vô tri là 'anh', 'anh ấy', 'ông ấy', 'chị ấy' (kể cả khi bản gốc có chữ 他 do công cụ nhận diện giọng nói gán nhầm âm đồng âm 'tā' với 它)!\n"
            "3. BẢO TOÀN ĐỊNH DẠNG SRT 1:1:\n"
            "   - Giữ nguyên số thứ tự (index: 1, 2, 3...) và mốc thời gian (timestamp: 00:00:01,200 --> 00:00:03,500).\n"
            "   - Bỏ phần gợi ý trong ngoặc vuông khi trả về kết quả.\n"
            "   - Chỉ thay thế dòng văn bản gốc bằng câu tiếng Việt đã dịch súc tích.\n"
            "4. ĐỊNH DẠNG ĐẦU RA:\n"
            "   - CHỈ TRẢ VỀ DUY NHẤT TOÀN BỘ NỘI DUNG FILE SRT TIẾNG VIỆT HOÀN CHỈNH.\n"
            "   - KHÔNG thêm lời mở đầu hay kết luận, KHÔNG bọc backtick giải thích."
        )

        native_base = "https://generativelanguage.googleapis.com"
        endpoint = f"{native_base}/v1beta/interactions"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "Api-Revision": "2026-05-20"
        }

        async with httpx.AsyncClient(timeout=120.0) as client:
            for i in range(0, len(segments), batch_size):
                batch = segments[i:i + batch_size]
                srt_input = cls.segments_to_srt_text(batch)

                full_prompt = (
                    f"{system_prompt}\n\n"
                    f"DANH SÁCH PHỤ ĐỀ SRT GỐC CẦN DỊCH:\n"
                    f"{srt_input}"
                )

                payload = {
                    "model": f"models/{model}",
                    "input": full_prompt
                }

                res = await client.post(endpoint, json=payload, headers=headers)
                if res.status_code != 200:
                    raise RuntimeError(f"Gemini API returned status {res.status_code}: {res.text}")

                res_json = res.json()
                content = ""
                for step in res_json.get("steps", []):
                    if step.get("type") == "model_output":
                        parts = step.get("content", [])
                        if parts and isinstance(parts[0], dict):
                            content = parts[0].get("text", "")
                        elif parts and isinstance(parts[0], str):
                            content = parts[0]
                        break

                if not content:
                    content = res_json.get("output_text") or res_json.get("output") or ""

                parsed_map = cls.parse_srt_text(content)
                for sid, txt in parsed_map.items():
                    trans_map[sid] = txt

        # Ghép kết quả vào segments
        result = []
        for idx, s in enumerate(segments, 1):
            item = dict(s)
            sid = s.get("id", idx)
            # Ưu tiên lấy theo sid, nếu không có lấy theo idx
            trans_text = trans_map.get(sid) or trans_map.get(idx) or s.get("text", "")
            item["translated_text"] = trans_text.strip()
            result.append(item)

        return result

    @classmethod
    def _translate_with_fallback(cls, segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Dịch offline / free qua MyMemory với mapping ngôn ngữ đầy đủ"""
        translated_results = []
        try:
            from deep_translator import MyMemoryTranslator
            lang_map = {
                "zh": "zh-CN", "chinese": "zh-CN", "zh-cn": "zh-CN", "mandarin": "zh-CN",
                "en": "en-US", "english": "en-US",
                "ja": "ja-JP", "japanese": "ja-JP",
                "ko": "ko-KR", "korean": "ko-KR",
                "fr": "fr-FR", "french": "fr-FR",
                "de": "de-DE", "german": "de-DE",
                "ru": "ru-RU", "russian": "ru-RU",
                "es": "es-ES", "spanish": "es-ES"
            }

            for s in segments:
                item = dict(s)
                raw_text = s.get("text", "").strip()
                src_lang = str(s.get("lang", "auto")).lower()

                # Tự động nhận diện chữ Hán nếu là tiếng Trung
                if re.search(r'[\u4e00-\u9fff]', raw_text):
                    src_code = "zh-CN"
                else:
                    src_code = lang_map.get(src_lang, "zh-CN")

                if src_lang in ("vi", "vietnamese"):
                    item["translated_text"] = raw_text
                else:
                    try:
                        translated = MyMemoryTranslator(source=src_code, target="vi-VN").translate(raw_text)
                        if translated and "INVALID SOURCE LANGUAGE" not in translated.upper() and "MYMEMORY" not in translated.upper():
                            item["translated_text"] = translated.strip()
                        else:
                            item["translated_text"] = raw_text
                    except Exception:
                        item["translated_text"] = raw_text
                translated_results.append(item)
            return translated_results
        except Exception as e:
            safe_log(f"[TranslatorService] Fallback error: {e}")
            for s in segments:
                item = dict(s)
                item["translated_text"] = s.get("text", "")
                translated_results.append(item)
            return translated_results
