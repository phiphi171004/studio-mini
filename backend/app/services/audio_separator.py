import subprocess
import shutil
import sys
import os
from pathlib import Path

class AudioSeparator:
    """
    Sử dụng Demucs để tách âm thanh thành:
    - Track A: Vocals (giọng review cũ) -> để nhận diện STT rồi xóa bỏ.
    - Track B: No-vocals (nhạc nền + SFX) -> giữ nguyên vẹn để mix lại.
    """

    @staticmethod
    def separate(audio_or_video_path: Path, output_dir: Path) -> dict:
        """
        Tách âm thanh bằng demucs.
        Trả về dict: {"vocals": Path, "no_vocals": Path}
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        stem_name = Path(audio_or_video_path).stem

        # Tự động phát hiện GPU (CUDA) để tăng tốc tách nhạc gấp 8-10 lần
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"

        # Chạy Demucs tách 2 stems (vocals và no_vocals)
        cmd = [
            sys.executable, "-m", "demucs.separate",
            "--two-stems", "vocals",
            "-n", "htdemucs",
            "-d", device,
            "-o", str(output_dir),
            str(audio_or_video_path)
        ]

        try:
            print(f"[AudioSeparator] Running Demucs on: {audio_or_video_path}...")
            process = subprocess.run(cmd, capture_output=True, text=True)
            
            result_folder = output_dir / "htdemucs" / stem_name
            vocals_file = result_folder / "vocals.wav"
            no_vocals_file = result_folder / "no_vocals.wav"

            if vocals_file.exists() and no_vocals_file.exists() and no_vocals_file.stat().st_size > 1000:
                print(f"[AudioSeparator] Demucs succeeded! Vocals: {vocals_file.stat().st_size}, BGM: {no_vocals_file.stat().st_size}")
                return {
                    "vocals": vocals_file,
                    "no_vocals": no_vocals_file
                }
            else:
                print(f"[AudioSeparator] Demucs output missing: {process.stderr[:300]}")
        except Exception as e:
            print(f"[AudioSeparator] Demucs execution failed: {e}")

        # Fallback nếu Demucs gặp sự cố
        return {
            "vocals": audio_or_video_path,
            "no_vocals": None
        }
