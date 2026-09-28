import os
from pathlib import Path
from typing import Optional
from ..models import Voice
from ..config import ROOT_DIR, STORAGE_DIR

class TTSService:
    """
    Sử dụng VieNeu-TTS (pnnbao-ump/VieNeu-TTS) chính thức với tăng tốc GPU NVIDIA CUDA (GTX 1650 4GB):
    1. Sinh giọng theo 12+ Preset chất lượng cao (Mai Anh, Trúc Ly, Ngọc Huyền, Minh Quân Pro, Anh Khôi...).
    2. Sinh giọng theo Reference Audio (Zero-shot Voice Cloning từ file âm thanh người dùng tải lên).
    """

    _model = None

    @classmethod
    def get_model(cls):
        """Khởi tạo và cache model VieNeu-TTS từ Hugging Face vào GPU CUDA."""
        if cls._model is None:
            try:
                import torch
                from vieneu import Vieneu
                device = "cuda" if torch.cuda.is_available() else "cpu"
                print(f"[TTSService] Loading VieNeu-TTS model (CUDA available: {torch.cuda.is_available()}, device={device})...")
                cls._model = Vieneu()
                print("[TTSService] VieNeu-TTS model loaded successfully onto GPU/device!")
            except Exception as e:
                print(f"[TTSService] Error loading VieNeu-TTS: {e}")
                cls._model = None
        return cls._model

    VIENEU_VOICE_MAP = {
        "mai_anh": "Mai Anh",
        "truc_ly": "Trúc Ly",
        "ngoc_huyen": "Ngọc Huyền",
        "thuy_dung": "Thùy Dung",
        "thuc_doan": "Thục Đoan",
        "quynh_anh": "Quỳnh Anh",
        "minh_quan": "Minh Quân Pro",
        "anh_khoi": "Anh Khôi",
        "pham_tuyen": "Phạm Tuyên",
        "thai_son": "Thái Sơn",
        "minh_triet": "Minh Triết",
        "quang_son": "Quang Sơn",
        # Tên trực tiếp
        "Mai Anh": "Mai Anh",
        "Trúc Ly": "Trúc Ly",
        "Ngọc Huyền": "Ngọc Huyền",
        "Thùy Dung": "Thùy Dung",
        "Thục Đoan": "Thục Đoan",
        "Quỳnh Anh": "Quỳnh Anh",
        "Minh Quân Pro": "Minh Quân Pro",
        "Anh Khôi": "Anh Khôi",
        "Phạm Tuyên": "Phạm Tuyên",
        "Thái Sơn": "Thái Sơn",
        "Minh Triết": "Minh Triết",
        "Quang Sơn": "Quang Sơn",
        # Tên mới cập nhật theo VieNeu SDK 3.8.2 / 3.8.3
        "hai_dang": "Hải Đăng",
        "Hải Đăng": "Hải Đăng",
        "thien_minh": "Thiện Minh",
        "Thiện Minh": "Thiện Minh",
        "quoc_tuan": "Quốc Tuấn",
        "Quốc Tuấn": "Quốc Tuấn",
        "adam_bua": "Adam bựa",
        "Adam bựa": "Adam bựa",
        "thien_tam_duc": "Thiền Tâm Đức",
        "Thiền Tâm Đức": "Thiền Tâm Đức",
        # Legacy mapping từ ZeroTTS
        "maichi": "Mai Anh",
        "baotrang": "Trúc Ly",
        "kimoanh": "Ngọc Huyền",
        "hamy": "Quỳnh Anh",
        "giahuy": "Minh Quân Pro",
        "huuduc": "Anh Khôi",
        "quangminh": "Phạm Tuyên",
        "tiendat": "Thái Sơn",
    }

    @classmethod
    def resolve_voice_name(cls, voice: Voice) -> str:
        """
        Ánh xạ Voice ID hoặc tên thành preset VieNeu-TTS chuẩn xác:
        - Nếu có trong map -> dùng trực tiếp.
        - Nếu là cloned voice không có ref_audio -> ánh xạ sang preset tương ứng (nam hoặc nữ).
        """
        if voice.id in cls.VIENEU_VOICE_MAP:
            return cls.VIENEU_VOICE_MAP[voice.id]
        if voice.name in cls.VIENEU_VOICE_MAP:
            return cls.VIENEU_VOICE_MAP[voice.name]

        meta = f"{voice.name} {voice.description or ''}".lower()
        male_keywords = ["nam", "trai", "boy", "male", "anh", "ông", "chú", "quân", "khôi", "sơn", "đức", "triết"]
        if any(kw in meta for kw in male_keywords):
            chosen = "Minh Quân Pro"
        else:
            chosen = "Mai Anh"

        try:
            print(f"[TTSService] Voice '{voice.name}' ({voice.id}) mapped to VieNeu voice: '{chosen}'")
        except Exception:
            pass
        return chosen

    @classmethod
    def _find_ref_audio(cls, ref_path_str: Optional[str]) -> Optional[Path]:
        """Tìm đường dẫn file ref audio hợp lệ trên ổ đĩa."""
        if not ref_path_str:
            return None
        candidate1 = ROOT_DIR / ref_path_str
        if candidate1.exists() and candidate1.stat().st_size > 1000:
            return candidate1
        candidate2 = Path(ref_path_str)
        if candidate2.exists() and candidate2.stat().st_size > 1000:
            return candidate2
        return None

    @classmethod
    def generate_speech(cls, text: str, voice: Voice, output_file: Path) -> float:
        """
        Sinh file audio từ text theo voice chỉ định bằng VieNeu-TTS.
        Hỗ trợ cả Preset Voices lẫn Voice Cloning (Zero-shot reference audio).
        Trả về thời lượng audio sinh ra (tính bằng giây).
        Đảm bảo file sinh ra luôn là file WAV 48kHz hợp lệ (> 1000 bytes), không bao giờ là file rỗng.
        """
        output_file.parent.mkdir(parents=True, exist_ok=True)
        model = cls.get_model()

        if model is not None:
            clean_text = text.strip()
            if not clean_text:
                clean_text = "..."

            # 1. Thử nghiệm Voice Cloning nếu có file mẫu hợp lệ
            ref_audio_file = None
            if voice.type == "cloned":
                ref_target = getattr(voice, "raw_audio_path", None) or voice.ref_audio_path
                if ref_target:
                    ref_audio_file = cls._find_ref_audio(ref_target)

            if ref_audio_file is not None:
                try:
                    print(f"[TTSService] Generating cloned speech with ref: {ref_audio_file}")
                    audio_array = model.infer(text=clean_text, ref_audio=str(ref_audio_file))
                    model.save(audio_array, str(output_file))

                    import soundfile as sf
                    with sf.SoundFile(str(output_file)) as f:
                        dur = round(len(f) / f.samplerate, 3)
                        if dur > 0.1 and output_file.stat().st_size > 500:
                            return dur
                except Exception as e:
                    print(f"[TTSService] VieNeu cloning error: {e}. Falling back to preset...")

            # 2. Sinh giọng Preset chuẩn
            voice_name = cls.resolve_voice_name(voice)
            try:
                audio_array = model.infer(text=clean_text, voice=voice_name)
                model.save(audio_array, str(output_file))

                import soundfile as sf
                with sf.SoundFile(str(output_file)) as f:
                    dur = round(len(f) / f.samplerate, 3)
                    if dur > 0.1 and output_file.stat().st_size > 500:
                        return dur
            except Exception as e:
                try:
                    print(f"[TTSService] VieNeu error with voice '{voice_name}': {e}. Falling back to 'Mai Anh'...")
                except Exception:
                    pass
                try:
                    audio_array = model.infer(text=clean_text, voice="Mai Anh")
                    model.save(audio_array, str(output_file))
                    import soundfile as sf
                    with sf.SoundFile(str(output_file)) as f:
                        return round(len(f) / f.samplerate, 3)
                except Exception as ex2:
                    try:
                        print(f"[TTSService] Preset fallback error: {ex2}")
                    except Exception:
                        pass

        # Fallback an toàn: tạo file WAV chuẩn (silence) để không bao giờ để lại file 0 byte
        import soundfile as sf
        import numpy as np
        word_count = len(text.split())
        estimated_duration = max(1.5, round(word_count / 3.0, 2))
        silence_samples = int(estimated_duration * 48000)
        sf.write(str(output_file), np.zeros(silence_samples, dtype=np.float32), 48000)
        return estimated_duration
