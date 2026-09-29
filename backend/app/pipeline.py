import os
import asyncio
from typing import Optional, List, Dict, Any
from pathlib import Path
from sqlalchemy.orm import Session
from .database import SessionLocal
from .models import DubbingTask, Voice
from .config import TEMP_DIR, OUTPUTS_DIR, UPLOADS_DIR
from .services.audio_separator import AudioSeparator
from .services.stt_service import STTService
from .services.translator import TranslatorService
from .services.tts_service import TTSService
from .services.timeline_aligner import TimelineAligner
from .services.media_composer import MediaComposer
from .services.subtitle_remover import SubtitleRemoverService

def update_task_progress(db: Session, task_id: str, step: str, progress: int, status: str = "processing", error: str = None):
    """Cập nhật tiến trình của task vào SQLite."""
    task = db.query(DubbingTask).filter(DubbingTask.id == task_id).first()
    if task:
        task.current_step = step
        task.progress = progress
        task.status = status
        if error:
            task.error_message = error
        db.commit()

def cleanup_task_resources(task_work_dir: Optional[Path] = None, input_video: Optional[Path] = None, custom_srt_path: Optional[Path] = None):
    """
    Tự động giải phóng 100% dung lượng ổ đĩa ngay khi hoàn thành:
    - Xóa thư mục tạm task_work_dir (chứa audio bóc tách, các stem vocal/bgm của Demucs, các file wav TTS nhỏ).
    - Xóa video gốc đã upload trong storage/uploads/ (video thành phẩm đã nằm ở storage/outputs/).
    - Xóa file custom SRT tạm nếu có trong storage/uploads/.
    """
    import shutil
    try:
        if task_work_dir and task_work_dir.exists():
            shutil.rmtree(task_work_dir, ignore_errors=True)
            print(f"[Pipeline] Đã xóa thư mục temp giải phóng ổ cứng: {task_work_dir}")
    except Exception as e:
        print(f"[Pipeline] Lỗi dọn dẹp task_work_dir: {e}")

    try:
        if input_video and input_video.exists():
            os.remove(input_video)
            print(f"[Pipeline] Đã xóa video gốc upload giải phóng ổ cứng: {input_video}")
    except Exception as e:
        print(f"[Pipeline] Lỗi dọn dẹp input_video: {e}")

    try:
        if custom_srt_path and Path(custom_srt_path).exists():
            os.remove(custom_srt_path)
    except Exception:
        pass

def auto_prune_storage(keep_count: int = 2):
    """
    Cơ chế Auto Retention toàn diện cho toàn bộ thư mục storage/:
    1. storage/uploads/: Chỉ giữ lại tối đa keep_count video gần nhất. Xóa file preview tạm và video cũ hơn.
    2. storage/outputs/:
       - Chỉ giữ lại tối đa keep_count video lồng tiếng gần nhất (dubbed_*.mp4) cùng các file .srt tương ứng.
       - Chỉ giữ lại tối đa keep_count video xóa phụ đề gần nhất (*_clean_*.mp4).
       - Xóa mọi file rác/temp mồ côi khác trong outputs.
    3. storage/temp/: Xóa các thư mục task tạm cũ.
    """
    import time
    import shutil
    try:
        # 1. DỌN DẸP storage/uploads/
        if UPLOADS_DIR.exists():
            # Xóa các file preview tạm tức thì nếu có nhiều hơn 1
            preview_files = sorted(
                list(UPLOADS_DIR.glob("subrem_temp_*")),
                key=lambda x: x.stat().st_mtime,
                reverse=True
            )
            for old_prev in preview_files[1:]:
                try:
                    if old_prev.is_file():
                        old_prev.unlink(missing_ok=True)
                except Exception:
                    pass

            # Lọc toàn bộ video trong uploads (loại trừ preview đã xử lý)
            video_exts = {".mp4", ".mov", ".mkv", ".avi", ".webm"}
            upload_videos = sorted(
                [f for f in UPLOADS_DIR.iterdir() if f.is_file() and f.suffix.lower() in video_exts and not f.name.startswith("subrem_temp_")],
                key=lambda x: x.stat().st_mtime,
                reverse=True
            )
            kept_upload_stems = set()
            for v in upload_videos[:keep_count]:
                kept_upload_stems.add(v.stem)

            # Xóa các video upload cũ vượt quá keep_count
            for old_vid in upload_videos[keep_count:]:
                try:
                    old_vid.unlink(missing_ok=True)
                    print(f"[Auto Retention] Đã xóa video upload cũ: {old_vid.name}")
                except Exception as e:
                    print(f"[Auto Retention] Lỗi xóa video upload cũ {old_vid.name}: {e}")

            # Xóa các file SRT custom trong uploads nếu video của nó không còn
            for srt in UPLOADS_DIR.glob("*.srt"):
                stem_base = srt.stem.replace("_custom", "")
                if stem_base not in kept_upload_stems:
                    try:
                        srt.unlink(missing_ok=True)
                    except Exception:
                        pass

        # 2. DỌN DẸP storage/outputs/
        if OUTPUTS_DIR.exists():
            # (a) Video lồng tiếng dubbed_*.mp4
            dubbed_videos = sorted(
                [f for f in OUTPUTS_DIR.glob("dubbed_*.mp4")],
                key=lambda x: x.stat().st_mtime,
                reverse=True
            )
            kept_dubbed_tasks = set()
            for v in dubbed_videos[:keep_count]:
                kept_dubbed_tasks.add(v.stem.replace("dubbed_", ""))

            for old_dub in dubbed_videos[keep_count:]:
                try:
                    old_dub.unlink(missing_ok=True)
                    print(f"[Auto Retention] Đã xóa dubbed video cũ: {old_dub.name}")
                except Exception as e:
                    print(f"[Auto Retention] Lỗi xóa {old_dub.name}: {e}")

            # (b) Video xóa phụ đề (*_clean_*.mp4 hoặc *_rem_*.mp4)
            clean_videos = sorted(
                [f for f in OUTPUTS_DIR.iterdir() if f.is_file() and ("_clean_" in f.name or "_nosub_" in f.name) and f.suffix.lower() == ".mp4"],
                key=lambda x: x.stat().st_mtime,
                reverse=True
            )
            for old_clean in clean_videos[keep_count:]:
                try:
                    old_clean.unlink(missing_ok=True)
                    print(f"[Auto Retention] Đã xóa video xóa sub cũ: {old_clean.name}")
                except Exception as e:
                    print(f"[Auto Retention] Lỗi xóa {old_clean.name}: {e}")

            # (c) Xóa file phụ đề .srt trong outputs không thuộc các task đang giữ
            for srt_file in OUTPUTS_DIR.glob("*.srt"):
                matches_kept = any(task_id in srt_file.name for task_id in kept_dubbed_tasks)
                if not matches_kept:
                    try:
                        srt_file.unlink(missing_ok=True)
                    except Exception:
                        pass

            # (d) Dọn dẹp bất kỳ file temp thừa nào trong outputs
            for junk in OUTPUTS_DIR.glob("*temp*"):
                try:
                    if junk.is_file():
                        junk.unlink(missing_ok=True)
                except Exception:
                    pass

        # 3. DỌN DẸP storage/temp/
        if TEMP_DIR.exists():
            now = time.time()
            for item in TEMP_DIR.iterdir():
                try:
                    # Nếu thư mục/file tồn tại hơn 15 phút thì dọn dẹp
                    if (now - item.stat().st_mtime) > 900:
                        if item.is_dir():
                            shutil.rmtree(item, ignore_errors=True)
                        else:
                            item.unlink(missing_ok=True)
                except Exception:
                    pass

    except Exception as e:
        print(f"[Auto Retention] Lỗi dọn dẹp storage: {e}")

# Giữ alias cho tương thích ngược
prune_old_outputs = auto_prune_storage

async def run_dubbing_pipeline(
    task_id: str,
    custom_srt_path: Optional[str] = None,
    remove_subtitles: bool = True,
    subtitle_removal_mode: str = "auto",
    subtitle_removal_engine: str = "big_lama",
    manual_regions: Optional[List[Dict[str, Any]]] = None,
    burn_subtitles: bool = False,
    auto_inplace_overlay: bool = False,
    subtitle_y: float = 0.78,
    subtitle_h: float = 0.14,
    subtitle_color: str = "yellow",
    inplace_style: Optional[Dict[str, Any]] = None
):
    """
    Hàm điều phối toàn bộ các bước của Pipeline Lồng Tiếng Video.
    Chạy bất đồng bộ (Background Task).
    """
    db = SessionLocal()
    try:
        task = db.query(DubbingTask).filter(DubbingTask.id == task_id).first()
        if not task:
            return

        voice = db.query(Voice).filter(Voice.id == task.voice_id).first()
        if not voice:
            update_task_progress(db, task_id, "error", 0, status="failed", error="Không tìm thấy giọng đọc chỉ định.")
            return

        task_work_dir = TEMP_DIR / task_id
        task_work_dir.mkdir(parents=True, exist_ok=True)

        input_video = Path(task.input_video_path)

        # [Bước 1/8] Trích xuất audio từ video gốc
        update_task_progress(db, task_id, "extracting_audio", 8)
        extracted_audio = task_work_dir / "original_audio.wav"
        MediaComposer.extract_audio(input_video, extracted_audio)

        # [Bước 2/8] Xóa chữ & phụ đề cũ của video (AI Inpainting)
        target_video = input_video
        if remove_subtitles:
            if subtitle_removal_engine == "frosted_glass":
                engine_label = "Khung Kính Mờ (Frosted Glass)"
            elif subtitle_removal_engine == "directml_onnx":
                engine_label = "DirectML ONNX"
            else:
                engine_label = "Big-LaMa CUDA"
            update_task_progress(db, task_id, f"removing_subtitles: Khởi động bộ quét AI ({engine_label})...", 10)
            clean_video = task_work_dir / f"clean_{input_video.name}"
            sub_task_id = f"sub_{task_id}"

            def on_remover_progress(step_msg: str, sub_pct: int):
                mapped_pct = 10 + int((sub_pct / 100.0) * 15)  # 10% -> 25%
                update_task_progress(db, task_id, f"removing_subtitles: {step_msg}", mapped_pct)

            is_auto = (subtitle_removal_mode == "auto")
            await SubtitleRemoverService.process_video_removal(
                task_id=sub_task_id,
                input_video=input_video,
                output_video=clean_video,
                boxes=manual_regions,
                auto_detect=is_auto,
                engine=subtitle_removal_engine,
                progress_callback=on_remover_progress
            )

            from .services.subtitle_remover import remover_tasks
            sub_task_info = remover_tasks.get(sub_task_id, {})
            if clean_video.exists() and clean_video.stat().st_size > 1000:
                target_video = clean_video
                update_task_progress(db, task_id, "removing_subtitles: ✅ Hoàn tất xóa chữ 100% -> Xuất video sạch thành công", 25)
                print(f"[Pipeline] 🎯 Đã xóa sạch chữ phụ đề gốc: {clean_video}")
            elif sub_task_info.get("status") == "failed":
                err_detail = sub_task_info.get("error", "Lỗi nén video hoặc bộ nhớ")
                print(f"[Pipeline] ❌ Lỗi xóa chữ: {err_detail}. Tiếp tục với video gốc.")
                update_task_progress(db, task_id, f"removing_subtitles: ⚠️ Lỗi ({err_detail[:40]}...), giữ video gốc", 25)
            else:
                update_task_progress(db, task_id, "removing_subtitles: Không phát hiện chữ cần xóa, giữ nguyên video gốc", 25)
                print(f"[Pipeline] ⚠️ Xóa chữ không phát hiện vùng cần xóa, tiếp tục với video gốc.")

            # Giữ trạng thái hoàn tất 1s để frontend kịp nhận log trước khi chuyển Bước 3
            await asyncio.sleep(1.0)

            # Giải phóng 100% VRAM GPU sau khi xóa chữ để nhường chỗ cho Demucs & TTS
            try:
                import torch
                import gc
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass
        else:
            update_task_progress(db, task_id, "skipped_subtitles", 15)
            await asyncio.sleep(0.3)

        # [Bước 3/8] Nhận diện giọng nói (STT) hoặc Sử dụng file phụ đề SRT người dùng tải lên
        update_task_progress(db, task_id, "transcribing", 30)
        if custom_srt_path and Path(custom_srt_path).exists() and Path(custom_srt_path).stat().st_size > 10:
            print(f"[Pipeline] 🎯 Đang sử dụng file phụ đề SRT chuẩn 100%: {custom_srt_path}")
            segments = STTService.parse_srt_file(Path(custom_srt_path))
        else:
            segments = STTService.transcribe(extracted_audio)

        # Xuất file phụ đề gốc (.SRT) ngay tại bước 3
        if segments:
            orig_srt_filename = f"subtitles_original_{task_id}.srt"
            orig_srt_path = OUTPUTS_DIR / orig_srt_filename
            STTService.export_to_srt(segments, orig_srt_path, text_key="text")
            task.original_srt_path = f"storage/outputs/{orig_srt_filename}"
            task.segments_data = segments
            db.commit()
            print(f"[Pipeline] Xuất phụ đề gốc thành công: {orig_srt_path}")

        # [Bước 4/8] Dịch kịch bản sang Tiếng Việt
        update_task_progress(db, task_id, "translating", 45)
        translated_segments = await TranslatorService.translate_segments(segments, target_lang="vi")

        # Xuất file phụ đề tiếng Việt (.SRT) ngay tại bước 4
        if translated_segments:
            vi_srt_filename = f"subtitles_vi_{task_id}.srt"
            vi_srt_path = OUTPUTS_DIR / vi_srt_filename
            STTService.export_to_srt(translated_segments, vi_srt_path, text_key="translated_text")
            task.translated_srt_path = f"storage/outputs/{vi_srt_filename}"
            task.segments_data = translated_segments
            db.commit()
            print(f"[Pipeline] Xuất phụ đề tiếng Việt thành công: {vi_srt_path}")

        # [Bước 5/8] Tách nhạc nền & xóa sạch giọng nói cũ bằng Demucs
        update_task_progress(db, task_id, "separating_audio", 60)
        separated = AudioSeparator.separate(extracted_audio, task_work_dir)
        vocals_track = separated["vocals"]
        bgm_track = separated["no_vocals"]

        # Xóa file vocal cũ để giải phóng dung lượng
        if vocals_track and vocals_track.exists():
            try:
                os.remove(vocals_track)
            except Exception:
                pass

        # [Bước 6/8] ZeroTTS / VieNeu-TTS sinh giọng đọc mới cho từng câu
        tts_audio_dir = task_work_dir / "tts_segments"
        tts_audio_dir.mkdir(parents=True, exist_ok=True)
        total_segs = len(translated_segments)

        for idx, seg in enumerate(translated_segments):
            pct = 65 + int((idx / max(total_segs, 1)) * 20)  # 65% -> 85%
            update_task_progress(db, task_id, f"generating_tts ({idx + 1}/{total_segs})", pct)

            seg_audio_file = tts_audio_dir / f"seg_{seg['id']}.wav"
            text_to_speak = seg.get("translated_text", seg.get("text", ""))
            duration = TTSService.generate_speech(text_to_speak, voice, seg_audio_file)
            seg["audio_duration"] = duration
            seg["audio_file"] = str(seg_audio_file)

        # [Bước 7] Đồng bộ timeline (Sequential Alignment) & Mix với Track B (BGM gốc)
        update_task_progress(db, task_id, "aligning_and_mixing", 85)
        aligned_segments = TimelineAligner.align_segments(translated_segments)
        
        # Cập nhật lại file phụ đề tiếng Việt với timestamp chuẩn theo timeline của nhân vật
        if aligned_segments and vi_srt_path:
            srt_segs = []
            for i, seg in enumerate(aligned_segments):
                s_item = dict(seg)
                s_start = seg.get("actual_start", seg.get("start", 0.0))
                if i < len(aligned_segments) - 1:
                    next_s = aligned_segments[i + 1].get("actual_start", aligned_segments[i + 1].get("start", s_start + 1.0))
                    s_end = min(seg.get("actual_end", s_start + seg.get("audio_duration", 1.0)), max(s_start + 0.3, next_s - 0.05))
                else:
                    s_end = seg.get("actual_end", seg.get("end", s_start + 1.0))
                s_item["start"] = round(s_start, 2)
                s_item["end"] = round(s_end, 2)
                srt_segs.append(s_item)
            STTService.export_to_srt(srt_segs, vi_srt_path, text_key="translated_text")

        # Lưu lại kịch bản và timestamp vào SQLite
        task.segments_data = aligned_segments
        db.commit()

        mixed_audio = task_work_dir / "final_dubbed_audio.wav"
        effective_bgm = bgm_track if (bgm_track and bgm_track.exists() and bgm_track.stat().st_size > 1000) else extracted_audio
        MediaComposer.compose_dubbed_audio(aligned_segments, effective_bgm, mixed_audio)

        # [Bước 8] Ghép audio đã mix vào video gốc -> xuất video hoàn chỉnh
        update_task_progress(db, task_id, "merging_video", 93)
        final_video_filename = f"dubbed_{task_id}.mp4"
        final_video_path = OUTPUTS_DIR / final_video_filename

        # [Tùy chọn: Tự động đè thẻ tại chỗ] Quét phát hiện mọi chữ trên video, dịch và đè thẻ chuẩn CapCut
        intermediate_video = target_video
        if auto_inplace_overlay:
            def on_overlay_progress(msg: str, pct: int):
                mapped_pct = 93 + int((pct / 100.0) * 4)  # 93% -> 97%
                update_task_progress(db, task_id, f"inplace_overlay: {msg}", mapped_pct)

            overlay_video_path = task_work_dir / f"overlay_{task_id}.mp4"
            from .services.inplace_overlay import InplaceOverlayService
            try:
                ok = await InplaceOverlayService.process_video_inplace_overlay(
                    input_video=target_video,
                    output_video=overlay_video_path,
                    dubbed_segments=aligned_segments,
                    text_color=subtitle_color,
                    style_config=inplace_style,
                    progress_callback=on_overlay_progress
                )
                if ok and overlay_video_path.exists() and overlay_video_path.stat().st_size > 1000:
                    intermediate_video = overlay_video_path
                    print(f"[Pipeline] 🏷️ Đã tạo thẻ đè phụ đề tiếng Việt tại chỗ thành công: {overlay_video_path}")
            except Exception as e:
                print(f"[Pipeline] ⚠️ Lỗi trong quá trình đè thẻ tại chỗ: {e}. Tiếp tục với video thông thường.")

        if burn_subtitles and vi_srt_path and vi_srt_path.exists():
            print(f"[Pipeline] 🔥 Tiến hành burn phụ đề mới trực tiếp vào video (Y: {subtitle_y}, H: {subtitle_h}, Color: {subtitle_color})...")
            success = MediaComposer.merge_audio_and_burn_subtitles(
                video_path=intermediate_video,
                audio_path=mixed_audio,
                srt_path=vi_srt_path,
                output_video_path=final_video_path,
                sub_y=subtitle_y,
                sub_h=subtitle_h,
                color=subtitle_color
            )
        else:
            success = MediaComposer.merge_audio_to_video(intermediate_video, mixed_audio, final_video_path)

        if not success or not final_video_path.exists() or final_video_path.stat().st_size < 1000:
            raise RuntimeError("FFmpeg không thể ghép video và audio thành phẩm.")

        # Hoàn tất!
        task.output_video_path = str(final_video_path.relative_to(OUTPUTS_DIR.parent.parent))
        task.status = "completed"
        task.current_step = "completed"
        task.progress = 100
        db.commit()

        # DỌN DẸP TỰ ĐỘNG: Giải phóng 100% dung lượng ổ cứng (xóa thư mục temp và video gốc upload)
        cleanup_task_resources(task_work_dir, input_video, Path(custom_srt_path) if custom_srt_path else None)

        # AUTO RETENTION: Toàn diện cho uploads, outputs và temp (chỉ giữ 2 video gần nhất)
        auto_prune_storage(keep_count=2)

    except Exception as e:
        import traceback
        traceback.print_exc()
        update_task_progress(db, task_id, "failed", 0, status="failed", error=str(e))
        # Dọn dẹp cả khi gặp lỗi để không tồn đọng file rác
        try:
            cleanup_task_resources(task_work_dir, input_video, Path(custom_srt_path) if custom_srt_path else None)
            auto_prune_storage(keep_count=2)
        except Exception:
            pass
    finally:
        db.close()
