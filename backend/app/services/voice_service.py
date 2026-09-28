import uuid
import os
from pathlib import Path
from sqlalchemy.orm import Session
from ..models import Voice
from ..config import DEFAULT_PRESET_VOICES, VOICES_DIR

def seed_default_voices(db: Session):
    """Khởi tạo danh sách giọng Preset của VieNeu-TTS vào SQLite, dọn dẹp các preset cũ."""
    valid_preset_ids = {p["id"] for p in DEFAULT_PRESET_VOICES}
    
    # Dọn dẹp các giọng preset cũ không còn trong danh sách (giữ nguyên giọng cloned của người dùng)
    db.query(Voice).filter(Voice.type == "preset", ~Voice.id.in_(valid_preset_ids)).delete(synchronize_session=False)

    for preset in DEFAULT_PRESET_VOICES:
        existing = db.query(Voice).filter(Voice.id == preset["id"]).first()
        preset_audio = f"storage/voices/presets/{preset['id']}.wav"
        if not existing:
            voice = Voice(
                id=preset["id"],
                name=preset["name"],
                type="preset",
                ref_audio_path=preset_audio,
                description=preset["description"],
                duration=None
            )
            db.add(voice)
        else:
            existing.name = preset["name"]
            existing.description = preset["description"]
            existing.ref_audio_path = preset_audio
    db.commit()

def get_all_voices(db: Session):
    """Lấy danh sách tất cả các giọng (Preset và Cloned)."""
    return db.query(Voice).order_by(Voice.type.desc(), Voice.name.asc()).all()

def get_voice(db: Session, voice_id: str):
    """Lấy thông tin 1 giọng theo ID."""
    return db.query(Voice).filter(Voice.id == voice_id).first()

def create_cloned_voice(db: Session, name: str, description: str, file_bytes: bytes, original_filename: str):
    """
    Tiếp nhận file ghi âm mẫu:
    1. Lưu file audio gốc của người dùng vào storage/voices/ (dùng làm mẫu prompt clone khi lồng tiếng).
    2. Gọi ngay mô hình VieNeu-TTS để nhân bản (clone) giọng và đọc thử 1 câu chào AI mẫu.
    3. Lưu file nghe thử AI vào storage/voices/{voice_id}_preview.wav để user nghe đúng giọng AI đã clone.
    """
    voice_id = f"voice_{uuid.uuid4().hex[:8]}"
    extension = Path(original_filename).suffix.lower() or ".wav"
    raw_filename = f"{voice_id}_raw{extension}"
    raw_path = VOICES_DIR / raw_filename

    # Ghi file audio gốc ra đĩa
    with open(raw_path, "wb") as f:
        f.write(file_bytes)

    # Ước lượng thời lượng audio gốc
    duration = None
    try:
        import soundfile as sf
        with sf.SoundFile(str(raw_path)) as f:
            duration = round(len(f) / f.samplerate, 2)
    except Exception:
        duration = None

    # Sinh ngay đoạn âm thanh AI đọc mẫu bằng chính giọng vừa clone
    preview_filename = f"{voice_id}_preview.wav"
    preview_path = VOICES_DIR / preview_filename
    preview_saved = False

    try:
        from .tts_service import TTSService
        model = TTSService.get_model()
        if model is not None:
            print(f"[VoiceService] Đang dùng VieNeu-TTS sinh giọng clone demo cho '{name}'...")
            preview_text = f"Xin chào, tôi là {name}. Đây là giọng đọc trí tuệ nhân tạo được nhân bản từ bản ghi âm của bạn."
            audio_array = model.infer(text=preview_text, ref_audio=str(raw_path))
            model.save(audio_array, str(preview_path))
            if preview_path.exists() and preview_path.stat().st_size > 1000:
                preview_saved = True
                print(f"[VoiceService] Đã tạo file nghe thử clone AI thành công: {preview_path}")
    except Exception as e:
        print(f"[VoiceService] Lỗi tạo preview clone bằng VieNeu-TTS: {e}")

    # Đường dẫn phát nghe thử (ưu tiên file AI đã clone đọc)
    ref_for_playback = str(preview_path.relative_to(VOICES_DIR.parent.parent)) if preview_saved else str(raw_path.relative_to(VOICES_DIR.parent.parent))
    raw_for_cloning = str(raw_path.relative_to(VOICES_DIR.parent.parent))

    # Lưu thông tin giọng vào SQLite
    voice = Voice(
        id=voice_id,
        name=name,
        type="cloned",
        ref_audio_path=ref_for_playback,
        raw_audio_path=raw_for_cloning,
        description=description,
        duration=duration
    )
    db.add(voice)
    db.commit()
    db.refresh(voice)
    return voice

def delete_voice(db: Session, voice_id: str):
    """Xóa một giọng cloned (không cho phép xóa preset)."""
    voice = db.query(Voice).filter(Voice.id == voice_id).first()
    if not voice:
        return False
    if voice.type == "preset":
        raise ValueError("Không thể xóa giọng mẫu mặc định của hệ thống.")

    # Cập nhật các tác vụ cũ từng dùng giọng này sang giọng mẫu 'mai_anh' để không vi phạm ràng buộc Foreign Key
    try:
        from ..models import DubbingTask
        db.query(DubbingTask).filter(DubbingTask.voice_id == voice_id).update(
            {DubbingTask.voice_id: "mai_anh"},
            synchronize_session=False
        )
    except Exception as e:
        print(f"[VoiceService] Cảnh báo cập nhật task liên quan: {e}")

    # Xóa file audio mẫu và file audio preview trên đĩa nếu có
    for path_attr in [voice.ref_audio_path, getattr(voice, "raw_audio_path", None)]:
        if path_attr:
            full_path = VOICES_DIR.parent.parent / path_attr
            if full_path.exists():
                try:
                    os.remove(full_path)
                except Exception:
                    pass

    db.delete(voice)
    db.commit()
    return True
