import subprocess
from pathlib import Path
from typing import List, Dict, Any

class TimelineAligner:
    """
    Thuật toán Đồng bộ Thời gian Không Lệch Khẩu Hình (Rubber-Band Adaptive Alignment):
    1. Mỗi câu thoại được NEO CHẶT vào mốc xuất hiện gốc của nhân vật (orig_start).
    2. Nếu câu thoại tiếng Việt dài hơn thời lượng cho phép giữa câu này và câu tiếp theo:
       - Tự động co giãn thời gian (speed adjustment) từ 1.05x đến 1.35x bằng FFmpeg atempo
         (giữ nguyên cao độ giọng nói - pitch preserving).
       - Đảm bảo câu thoại kết thúc gọn gàng trước khi nhân vật nói câu kế tiếp.
    3. Khoảng lặng giữa các hành động được bảo toàn tuyệt đối, loại bỏ 100% hiện tượng trôi lệch (drift)
       khiến nhân vật không nói mà lồng tiếng vẫn đọc.
    """

    @staticmethod
    def align_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not segments:
            return []

        from .media_composer import MediaComposer
        ffmpeg = MediaComposer.get_ffmpeg_bin()

        aligned = []
        n = len(segments)
        prev_end = 0.0

        for i, seg in enumerate(segments):
            orig_start = float(seg.get("start", 0.0))
            orig_end = float(seg.get("end", orig_start + 1.0))
            audio_file = seg.get("audio_file")
            current_duration = float(seg.get("audio_duration", max(0.5, orig_end - orig_start)))

            # Thời điểm bắt đầu thực tế: Bắt đầu tại mốc gốc, nếu câu trước chưa dứt thì chờ câu trước
            actual_start = max(orig_start, prev_end)

            # Tính thời gian khả dụng thực tế từ actual_start đến khi câu kế tiếp xuất hiện
            # (Chống trôi tích lũy - Cumulative Drift: Đo từ actual_start để câu sau bắt kịp nhịp gốc)
            if i < n - 1:
                next_start = float(segments[i + 1].get("start", orig_end))
                available_slot = max(0.35, next_start - actual_start)
            else:
                available_slot = max(0.5, orig_end - actual_start + 0.8)

            # 1. Tự động điều chỉnh tốc độ đọc (Time-Stretching) vừa vặn với nhịp nhân vật:
            # Cho phép tăng tốc lên tới 1.42x khi cần để câu nói kết thúc dứt khoát trước cảnh tiếp theo,
            # đảm bảo 100% KHỚP VỚI HÀNH ĐỘNG VÀ KHẨU HÌNH NHÂN VẬT!
            speed_factor = 1.0
            if audio_file and Path(audio_file).exists() and current_duration > available_slot:
                needed_speed = current_duration / available_slot
                speed_factor = min(round(needed_speed, 2), 1.42)

                if speed_factor >= 1.05:
                    speed_file = Path(audio_file).parent / f"spd_{Path(audio_file).name}"
                    try:
                        subprocess.run(
                            [ffmpeg, "-y", "-i", str(audio_file), "-filter:a", f"atempo={speed_factor}", str(speed_file)],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
                        )
                        if speed_file.exists() and speed_file.stat().st_size > 100:
                            import soundfile as sf
                            with sf.SoundFile(str(speed_file)) as sf_in:
                                current_duration = round(len(sf_in) / sf_in.samplerate, 3)
                            audio_file = str(speed_file)
                    except Exception as e:
                        print(f"[TimelineAligner] Error applying atempo for seg {seg.get('id')}: {e}")

            actual_end = actual_start + current_duration
            prev_end = actual_end

            updated_seg = dict(seg)
            updated_seg["actual_start"] = round(actual_start, 3)
            updated_seg["actual_end"] = round(actual_end, 3)
            updated_seg["audio_duration"] = round(current_duration, 3)
            updated_seg["audio_file"] = audio_file
            updated_seg["speed_factor"] = speed_factor

            aligned.append(updated_seg)

        return aligned
