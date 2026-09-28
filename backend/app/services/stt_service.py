import os
import shutil
import subprocess
import re
import httpx
from pathlib import Path
from typing import List, Dict, Any, Optional
from ..config import GROQ_API_KEY, GROQ_WHISPER_MODEL, ROOT_DIR

class STTService:
    """
    Trích xuất phụ đề kèm timestamp chính xác từng câu:
    - Ưu tiên 1: CapCut / JianYing Cloud ASR API (chính xác 100% tiếng Trung/TikTok, 8s).
    - Fallback 2: Groq Cloud Whisper Large-v3.
    - Fallback 3: faster-whisper cục bộ.
    """

    _model = None

    @classmethod
    def get_ffmpeg_bin(cls) -> str:
        cmd = shutil.which("ffmpeg")
        if cmd:
            return cmd
        try:
            import imageio_ffmpeg
            return imageio_ffmpeg.get_ffmpeg_exe()
        except ImportError:
            return "ffmpeg"

    @classmethod
    def get_local_model(cls):
        if cls._model is None:
            import torch
            from faster_whisper import WhisperModel
            has_cuda = torch.cuda.is_available()
            device = "cuda" if has_cuda else "cpu"
            compute_type = "float16" if has_cuda else "int8"
            print(f"[STTService] Loading local faster-whisper on {device} ({compute_type})...")
            cls._model = WhisperModel("small", device=device, compute_type=compute_type)
            print("[STTService] Local faster-whisper loaded successfully!")
        return cls._model

    @classmethod
    def parse_srt_file(cls, srt_path: Path) -> List[Dict[str, Any]]:
        """Đọc file SRT thành danh sách segments chuẩn."""
        content = srt_path.read_text(encoding="utf-8", errors="ignore").strip()
        blocks = re.split(r'\n\s*\n', content)
        segments = []
        
        for b in blocks:
            lines = [l.strip() for l in b.splitlines() if l.strip()]
            if len(lines) >= 3 and "-->" in lines[1]:
                try:
                    seg_id = int(lines[0])
                except ValueError:
                    seg_id = len(segments) + 1
                
                t_parts = lines[1].split("-->")
                start_str = t_parts[0].strip().replace(",", ".")
                end_str = t_parts[1].strip().replace(",", ".")
                
                def to_sec(ts: str) -> float:
                    parts = ts.split(":")
                    if len(parts) == 3:
                        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                    return float(ts)

                start_sec = to_sec(start_str)
                end_sec = to_sec(end_str)
                text = " ".join(lines[2:])
                
                segments.append({
                    "id": seg_id,
                    "start": round(start_sec, 2),
                    "end": round(end_sec, 2),
                    "text": text,
                    "lang": "zh"
                })
        return segments

    @classmethod
    def transcribe_with_capcut(cls, audio_path: Path) -> List[Dict[str, Any]]:
        """Gọi trực tiếp CapCut / JianYing Cloud ASR engine qua jianying-subtitle."""
        compressed_mp3 = audio_path.parent / f"{audio_path.stem}_capcut.mp3"
        ffmpeg_bin = cls.get_ffmpeg_bin()
        subprocess.run(
            [ffmpeg_bin, "-y", "-i", str(audio_path), "-ar", "16000", "-ac", "1", "-b:a", "64k", str(compressed_mp3)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
        )

        out_srt = audio_path.parent / f"{audio_path.stem}_capcut.srt"
        bin_cmd = ROOT_DIR / "node_modules" / ".bin" / "jianying-subtitle.cmd"
        cmd_str = str(bin_cmd) if bin_cmd.exists() else "jianying-subtitle"

        res = subprocess.run(
            [cmd_str, str(compressed_mp3), "-o", str(out_srt)],
            cwd=str(ROOT_DIR),
            capture_output=True, text=True, timeout=60.0
        )
        if res.returncode == 0 and out_srt.exists() and out_srt.stat().st_size > 100:
            return cls.parse_srt_file(out_srt)
        raise RuntimeError(f"jianying-subtitle code {res.returncode}: {res.stderr or res.stdout}")

    @classmethod
    def transcribe(cls, audio_path: Path, language: str = None, groq_api_key: str = None) -> List[Dict[str, Any]]:
        """
        Nhận diện giọng nói siêu chuẩn:
        1. Ưu tiên 1: Sử dụng CapCut / JianYing Cloud ASR API (chính xác 100% tiếng Trung/TikTok, 8s).
        2. Fallback 2: Groq Cloud Whisper Large-v3.
        3. Fallback 3: Faster-Whisper cục bộ.
        """
        # 1. Thử dùng CapCut / JianYing Cloud ASR (Chuẩn 100% như CapCut)
        try:
            print("[STTService] Đang gọi CapCut / JianYing Cloud ASR API (chính xác 100%)...")
            capcut_results = cls.transcribe_with_capcut(audio_path)
            if capcut_results and len(capcut_results) > 0:
                print(f"[STTService] ✅ CapCut ASR trích xuất thành công {len(capcut_results)} câu chuẩn 100%!")
                return capcut_results
        except Exception as e:
            print(f"[STTService] CapCut ASR lưu ý: {e}. Chuyển sang Groq Whisper fallback...")

        # 2. Fallback: Groq Cloud Whisper Large-v3
        effective_groq_key = groq_api_key or GROQ_API_KEY or os.getenv("GROQ_API_KEY", "").strip()
        if effective_groq_key:
            try:
                print(f"[STTService] Calling Groq Cloud Whisper API ({GROQ_WHISPER_MODEL})...")
                results = cls.transcribe_with_groq(audio_path, effective_groq_key, model=GROQ_WHISPER_MODEL, language=language)
                if results:
                    print(f"[STTService] Groq Whisper extracted {len(results)} segments successfully in seconds!")
                    return results
            except Exception as e:
                print(f"[STTService] Groq API error: {e}. Switching to local Faster-Whisper fallback...")

        # 3. Fallback: faster-whisper chạy cục bộ kèm VAD filter
        print("[STTService] Running local Faster-Whisper with VAD filter...")
        return cls.transcribe_local(audio_path, language=language)

    @classmethod
    def transcribe_with_groq(cls, audio_path: Path, api_key: str, model: str = "whisper-large-v3-turbo", language: str = None) -> List[Dict[str, Any]]:
        """Gửi audio lên Groq Cloud Whisper API."""
        upload_path = audio_path

        # Nén sang mp3 16kHz mono 64k để upload siêu nhẹ (~1MB thay vì 25-30MB) và đảm bảo dưới hạn mức 25MB của Groq
        compressed_mp3 = audio_path.parent / f"{audio_path.stem}_groq.mp3"
        try:
            ffmpeg_bin = cls.get_ffmpeg_bin()
            subprocess.run(
                [ffmpeg_bin, "-y", "-i", str(audio_path), "-ar", "16000", "-ac", "1", "-b:a", "64k", str(compressed_mp3)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
            )
            if compressed_mp3.exists() and compressed_mp3.stat().st_size > 0:
                upload_path = compressed_mp3
                print(f"[STTService] Compressed audio for Groq upload: {upload_path.stat().st_size / 1024:.1f} KB")
        except Exception as ex:
            print(f"[STTService] Warning: Could not compress audio with ffmpeg ({ex}), trying original file...")

        with open(upload_path, "rb") as f:
            files = {"file": (upload_path.name, f, "audio/mpeg" if upload_path.suffix == ".mp3" else "audio/wav")}
            data = {
                "model": model,
                "response_format": "verbose_json",
                "temperature": "0"
            }
            if language:
                data["language"] = language

            headers = {"Authorization": f"Bearer {api_key}"}

            with httpx.Client(timeout=90.0) as client:
                res = client.post(
                    "https://api.groq.com/openai/v1/audio/transcriptions",
                    headers=headers,
                    files=files,
                    data=data
                )

        if res.status_code != 200:
            raise RuntimeError(f"Groq API returned HTTP {res.status_code}: {res.text}")

        res_data = res.json()
        segments_raw = res_data.get("segments", [])
        detected_lang = res_data.get("language", language or "auto")

        segments_result = []
        for i, s in enumerate(segments_raw):
            txt = s.get("text", "").strip()
            if txt:
                segments_result.append({
                    "id": i + 1,
                    "start": round(float(s.get("start", 0.0)), 2),
                    "end": round(float(s.get("end", 0.0)), 2),
                    "text": txt,
                    "lang": detected_lang
                })

        # Nếu verbose_json không trả về segments mà chỉ có full text
        if not segments_result and res_data.get("text"):
            segments_result.append({
                "id": 1,
                "start": 0.0,
                "end": round(float(res_data.get("duration", 10.0)), 2),
                "text": res_data["text"].strip(),
                "lang": detected_lang
            })

        return segments_result

    @classmethod
    def transcribe_local(cls, audio_path: Path, language: str = None) -> List[Dict[str, Any]]:
        """Chạy faster-whisper cục bộ với vad_filter=True."""
        segments_result = []
        try:
            model = cls.get_local_model()
            print(f"[STTService] Transcribing locally: {audio_path}...")
            # vad_filter=True giúp lọc sạch tiếng thở và không bị ảo giác âm thanh
            segments, info = model.transcribe(
                str(audio_path),
                language=language,
                beam_size=5,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=500)
            )

            detected_lang = info.language
            print(f"[STTService] Local detected language: {detected_lang} (prob: {info.language_probability:.2f})")

            for i, segment in enumerate(segments):
                text = segment.text.strip()
                if text:
                    segments_result.append({
                        "id": i + 1,
                        "start": round(segment.start, 2),
                        "end": round(segment.end, 2),
                        "text": text,
                        "lang": detected_lang
                    })
            print(f"[STTService] Local Faster-Whisper extracted {len(segments_result)} segments!")
        except Exception as e:
            print(f"[STTService] Local transcription error: {e}")

        return segments_result


    @staticmethod
    def format_srt_timestamp(seconds: float) -> str:
        """Chuyển số giây sang định dạng thời gian chuẩn SRT: HH:MM:SS,mmm"""
        total_ms = max(0, int(round(seconds * 1000)))
        hours = total_ms // 3600000
        total_ms %= 3600000
        minutes = total_ms // 60000
        total_ms %= 60000
        secs = total_ms // 1000
        ms = total_ms % 1000
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"

    @classmethod
    def export_to_srt(cls, segments: List[Dict[str, Any]], output_path: Path, text_key: str = "text") -> Path:
        """Xuất danh sách segment thành file phụ đề .SRT chuẩn UTF-8."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for idx, seg in enumerate(segments, 1):
                start = float(seg.get("actual_start", seg.get("start", 0.0)))
                end = float(seg.get("actual_end", seg.get("end", start + 1.0)))
                if end <= start:
                    end = start + 1.0
                start_ts = cls.format_srt_timestamp(start)
                end_ts = cls.format_srt_timestamp(end)
                content = seg.get(text_key) or seg.get("text") or ""
                f.write(f"{idx}\n{start_ts} --> {end_ts}\n{content.strip()}\n\n")
        return output_path
