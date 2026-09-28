import subprocess
import shutil
import os
from pathlib import Path
from typing import List, Dict, Any
import soundfile as sf
import numpy as np

class MediaComposer:
    """
    Xử lý Media với FFmpeg & SoundFile/NumPy:
    1. Trích xuất audio từ video gốc.
    2. Ghép các đoạn audio giọng đọc theo timeline (Sequential alignment).
    3. Mix Track giọng mới + Track B (Nhạc nền & SFX gốc).
    4. Ghép audio đã mix vào video gốc thành sản phẩm cuối.
    """

    @classmethod
    def get_ffmpeg_bin(cls) -> str:
        """Tìm đường dẫn ffmpeg: ưu tiên hệ thống hoặc qua imageio-ffmpeg."""
        cmd = shutil.which("ffmpeg")
        if cmd:
            return cmd
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            return "ffmpeg"

    @classmethod
    def extract_audio(cls, video_path: Path, output_audio_path: Path) -> bool:
        """Trích xuất audio từ video sang file wav 44.1kHz stereo chuẩn."""
        ffmpeg = cls.get_ffmpeg_bin()
        output_audio_path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [
            ffmpeg, "-y",
            "-i", str(video_path),
            "-vn", "-acodec", "pcm_s16le", "-ar", "44100", "-ac", "2",
            str(output_audio_path)
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True)
            return res.returncode == 0 and output_audio_path.exists() and output_audio_path.stat().st_size > 1000
        except Exception as e:
            print(f"[MediaComposer] Lỗi trích xuất audio: {e}")
            return False

    @classmethod
    def compose_dubbed_audio(cls, segments: List[Dict[str, Any]], bgm_track: Path, output_audio: Path) -> bool:
        """
        Ghép các đoạn audio ZeroTTS vào đúng timeline và mix với track nhạc nền (BGM)
        sử dụng NumPy để căn chỉnh và FFmpeg để mix âm thanh chuẩn phòng thu:
        - Giọng lồng tiếng ZeroTTS tăng âm lượng nhẹ (x1.35) để rõ lời, nổi bật.
        - Nhạc nền (BGM) giữ ở mức vừa phải (x0.22) không lấn át lời thoại.
        - Đảm bảo chất lượng âm thanh 48kHz nguyên bản, không méo tiếng, không chậm nhịp.
        """
        output_audio.parent.mkdir(parents=True, exist_ok=True)
        ffmpeg = cls.get_ffmpeg_bin()
        target_sr = 48000  # Chuẩn tần số mẫu của ZeroTTS

        # 1. Tính tổng thời lượng cần thiết
        max_duration = 5.0
        for seg in segments:
            actual_end = seg.get("actual_end", seg.get("actual_start", 0.0) + seg.get("audio_duration", 2.0))
            if actual_end > max_duration:
                max_duration = actual_end

        # Nếu có file BGM hợp lệ, lấy thời lượng theo BGM
        bgm_valid = bgm_track and bgm_track.exists() and bgm_track.stat().st_size > 4096
        if bgm_valid:
            try:
                with sf.SoundFile(str(bgm_track)) as f:
                    bgm_dur = len(f) / f.samplerate
                    if bgm_dur > max_duration:
                        max_duration = bgm_dur
            except Exception:
                bgm_valid = False

        total_samples = int((max_duration + 2.0) * target_sr)
        voice_buffer = np.zeros(total_samples, dtype=np.float32)

        # 2. Chèn từng câu thoại ZeroTTS vào buffer theo đúng actual_start
        inserted_count = 0
        for seg in segments:
            audio_f = seg.get("audio_file")
            if not audio_f or not Path(audio_f).exists() or Path(audio_f).stat().st_size < 100:
                continue

            try:
                data, s_sr = sf.read(audio_f)
                if data.ndim > 1:
                    data = data.mean(axis=1)  # Chuyển mono
                
                # Resample voice nếu khác target_sr (thường ZeroTTS đã là 48000)
                if s_sr != target_sr:
                    from scipy.signal import resample
                    target_len = int(len(data) * target_sr / s_sr)
                    data = resample(data, target_len).astype(np.float32)

                # Áp dụng fade-in/fade-out siêu mượt (15ms) để giọng nói tự nhiên, không ngắt gắt, không có tiếng click/pop
                fade_samples = int(0.015 * target_sr)
                if len(data) > 2 * fade_samples:
                    data[:fade_samples] *= np.linspace(0.0, 1.0, fade_samples, dtype=np.float32)
                    data[-fade_samples:] *= np.linspace(1.0, 0.0, fade_samples, dtype=np.float32)

                start_sample = int(seg.get("actual_start", 0.0) * target_sr)
                end_sample = start_sample + len(data)

                if end_sample > len(voice_buffer):
                    voice_buffer = np.pad(voice_buffer, (0, end_sample - len(voice_buffer) + target_sr))

                voice_buffer[start_sample:end_sample] += data.astype(np.float32)
                inserted_count += 1
            except Exception as e:
                print(f"[MediaComposer] Lỗi chèn segment {seg.get('id')}: {e}")

        print(f"[MediaComposer] Đã xếp {inserted_count}/{len(segments)} câu thoại lồng tiếng vào timeline.")

        # Chuẩn hóa âm lượng voice track
        max_v = np.max(np.abs(voice_buffer))
        if max_v > 1.0:
            voice_buffer = voice_buffer / max_v * 0.95

        # Lưu track giọng nói hoàn chỉnh ra file tạm
        timed_vocals_path = output_audio.parent / "timed_vocals.wav"
        sf.write(str(timed_vocals_path), np.column_stack([voice_buffer, voice_buffer]), target_sr)

        # 3. Mix track giọng mới với Track BGM (nhạc nền) bằng FFmpeg amix
        if bgm_valid:
            mix_cmd = [
                ffmpeg, "-y",
                "-i", str(timed_vocals_path),
                "-i", str(bgm_track),
                "-filter_complex",
                "[0:a]volume=1.35[v];[1:a]volume=0.22[b];[v][b]amix=inputs=2:duration=longest:dropout_transition=2[out]",
                "-map", "[out]",
                "-ar", "48000",
                "-ac", "2",
                str(output_audio)
            ]
            try:
                print(f"[MediaComposer] Đang mix giọng thuyết minh (x1.35) + nhạc nền (x0.22) bằng FFmpeg...")
                res = subprocess.run(mix_cmd, capture_output=True, text=True)
                if res.returncode == 0 and output_audio.exists() and output_audio.stat().st_size > 1000:
                    print(f"[MediaComposer] ✅ Mix thành công: {output_audio} ({output_audio.stat().st_size} bytes)")
                    return True
                else:
                    print(f"[MediaComposer] FFmpeg amix lỗi: {res.stderr[:200]}")
            except Exception as e:
                print(f"[MediaComposer] Lỗi chạy FFmpeg mix: {e}")

        # Nếu không có BGM hoặc FFmpeg mix lỗi, dùng trực tiếp timed_vocals
        shutil.copy(timed_vocals_path, output_audio)
        print(f"[MediaComposer] Đã xuất file audio hoàn chỉnh từ timed_vocals: {output_audio}")
        return True

    @classmethod
    def get_video_dimensions(cls, video_path: Path) -> tuple[int, int]:
        """Lấy kích thước (width, height) của video bằng cv2 hoặc ffprobe."""
        try:
            import cv2
            cap = cv2.VideoCapture(str(video_path))
            if cap.isOpened():
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                cap.release()
                if w > 0 and h > 0:
                    return w, h
        except Exception:
            pass
        return 1280, 720

    @classmethod
    def convert_srt_to_ass(
        cls,
        srt_path: Path,
        ass_path: Path,
        video_w: int = 1280,
        video_h: int = 720,
        sub_y: float = 0.78,
        sub_h: float = 0.14,
        color: str = "yellow"
    ) -> bool:
        """
        Chuyển file SRT sang ASS định dạng chuẩn CapCut/TikTok với vị trí MarginV và màu sắc chính xác theo khung user đã chọn.
        """
        if not srt_path.exists() or srt_path.stat().st_size < 5:
            return False

        # Màu sắc ASS: &HAABBGGRR
        color_map = {
            "yellow": "&H0000FFFF",  # Vàng chanh
            "cyan": "&H00FFFF00",    # Xanh ngọc
            "white": "&H00FFFFFF",   # Trắng tuyết
        }
        primary_color = color_map.get(color.lower(), "&H0000FFFF")

        # Tính MarginV: khoảng cách từ mép dưới video tới đáy chữ
        # sub_y: 0.0 -> 1.0 (từ mép trên), sub_h: 0.0 -> 1.0
        # Tâm hoặc đáy dòng chữ trong khung:
        margin_v = max(12, int((1.0 - (sub_y + sub_h * 0.85)) * video_h))
        font_size = max(18, int(video_h * 0.046))

        ass_header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {video_w}
PlayResY: {video_h}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CapCutSub,Arial,{font_size},{primary_color},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.8,1.2,2,30,30,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
        def srt_time_to_ass(st: str) -> str:
            st = st.strip().replace(',', '.')
            pts = st.split(':')
            if len(pts) == 3:
                h = int(pts[0])
                m = pts[1]
                s_pts = pts[2].split('.')
                s = s_pts[0]
                ms = s_pts[1] if len(s_pts) > 1 else '00'
                cs = ms[:2].ljust(2, '0')
                return f"{h}:{m}:{s}.{cs}"
            return "0:00:00.00"

        try:
            content = srt_path.read_text(encoding="utf-8", errors="ignore")
            # Tách các block srt
            import re
            blocks = re.split(r'\n\s*\n', content.strip())
            dialogues = []
            for b in blocks:
                lines = [l.strip() for l in b.splitlines() if l.strip()]
                if len(lines) >= 3 and '-->' in lines[1]:
                    time_line = lines[1]
                    m = re.match(r'(\d+:\d+:\d+[\.,]\d+)\s*-->\s*(\d+:\d+:\d+[\.,]\d+)', time_line)
                    if m:
                        start_ass = srt_time_to_ass(m.group(1))
                        end_ass = srt_time_to_ass(m.group(2))
                        text = " ".join(lines[2:])
                        # Thoát dấu ngoặc ASS nếu có
                        text = text.replace('{', '\\{').replace('}', '\\}')
                        dialogues.append(f"Dialogue: 0,{start_ass},{end_ass},CapCutSub,,0,0,{margin_v},,{text}")
                elif len(lines) >= 2 and '-->' in lines[0]:
                    time_line = lines[0]
                    m = re.match(r'(\d+:\d+:\d+[\.,]\d+)\s*-->\s*(\d+:\d+:\d+[\.,]\d+)', time_line)
                    if m:
                        start_ass = srt_time_to_ass(m.group(1))
                        end_ass = srt_time_to_ass(m.group(2))
                        text = " ".join(lines[1:])
                        text = text.replace('{', '\\{').replace('}', '\\}')
                        dialogues.append(f"Dialogue: 0,{start_ass},{end_ass},CapCutSub,,0,0,{margin_v},,{text}")

            ass_path.parent.mkdir(parents=True, exist_ok=True)
            ass_path.write_text(ass_header + "\n".join(dialogues) + "\n", encoding="utf-8")
            print(f"[MediaComposer] Da tao file phu de ASS: {ass_path.name} ({len(dialogues)} cau thoai, MarginV={margin_v})")
            return True
        except Exception as e:
            print(f"[MediaComposer] Loi convert SRT sang ASS: {e}")
            return False

    @classmethod
    def merge_audio_and_burn_subtitles(
        cls,
        video_path: Path,
        audio_path: Path,
        srt_path: Path,
        output_video_path: Path,
        sub_y: float = 0.78,
        sub_h: float = 0.14,
        color: str = "yellow"
    ) -> bool:
        """Ghép video + audio đồng thời burn phụ đề mới đúng theo vị trí khung đã tùy chỉnh."""
        ffmpeg = cls.get_ffmpeg_bin()
        output_video_path.parent.mkdir(parents=True, exist_ok=True)

        w, h = cls.get_video_dimensions(video_path)
        ass_path = output_video_path.parent / f"temp_{output_video_path.stem}.ass"

        ass_success = cls.convert_srt_to_ass(
            srt_path=srt_path,
            ass_path=ass_path,
            video_w=w,
            video_h=h,
            sub_y=sub_y,
            sub_h=sub_h,
            color=color
        )

        if not ass_success:
            print(f"[MediaComposer] Khong tao duoc ASS, fallback sang merge thong thuong...")
            return cls.merge_audio_to_video(video_path, audio_path, output_video_path)

        escaped_ass = str(ass_path).replace("\\", "/").replace(":", "\\:")
        cmd = [
            ffmpeg, "-y",
            "-i", str(video_path),
            "-i", str(audio_path),
            "-vf", f"ass='{escaped_ass}'",
            "-c:v", "libx264",
            "-preset", "fast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            str(output_video_path)
        ]

        try:
            print(f"[MediaComposer] Dang render video & burn phu de moi: {output_video_path.name}...")
            res = subprocess.run(cmd, capture_output=True, text=True)
            # Dọn dẹp file ass tạm
            if ass_path.exists():
                try:
                    ass_path.unlink()
                except Exception:
                    pass

            if res.returncode == 0 and output_video_path.exists() and output_video_path.stat().st_size > 1000:
                print(f"[MediaComposer] Render video + Phu de thanh cong: {output_video_path.stat().st_size} bytes")
                return True
            else:
                print(f"[MediaComposer] Burn phu de that bai ({res.stderr[:200]}), fallback sang merge khong burn...")
                return cls.merge_audio_to_video(video_path, audio_path, output_video_path)
        except Exception as e:
            print(f"[MediaComposer] Loi render video + phu de: {e}")
            return cls.merge_audio_to_video(video_path, audio_path, output_video_path)

    @classmethod
    def merge_audio_to_video(cls, video_path: Path, audio_path: Path, output_video_path: Path) -> bool:
        """Ghép video gốc (giữ nguyên hình ảnh) với track audio đã mix mới bằng FFmpeg."""
        ffmpeg = cls.get_ffmpeg_bin()
        output_video_path.parent.mkdir(parents=True, exist_ok=True)

        # Lệnh ghép audio vào video
        cmd = [
            ffmpeg, "-y",
            "-i", str(video_path),
            "-i", str(audio_path),
            "-c:v", "copy",
            "-c:a", "aac",
            "-b:a", "192k",
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-shortest",
            str(output_video_path)
        ]
        try:
            print(f"[MediaComposer] Đang render video: {output_video_path}...")
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode == 0 and output_video_path.exists() and output_video_path.stat().st_size > 1000:
                print(f"[MediaComposer] ✅ Render video thành công: {output_video_path.stat().st_size} bytes")
                return True
            else:
                print(f"[MediaComposer] FFmpeg copy thất bại, thử re-encode: {res.stderr[:200]}")
                # Fallback re-encode nếu copy luồng video thất bại
                cmd_fallback = [
                    ffmpeg, "-y",
                    "-i", str(video_path),
                    "-i", str(audio_path),
                    "-c:v", "libx264",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    str(output_video_path)
                ]
                res2 = subprocess.run(cmd_fallback, capture_output=True, text=True)
                return res2.returncode == 0 and output_video_path.exists() and output_video_path.stat().st_size > 1000
        except Exception as e:
            print(f"[MediaComposer] Lỗi merge video: {e}")
            return False
