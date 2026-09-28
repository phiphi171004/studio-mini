import os
import sys

# Thiết lập UTF-8 encoding cho console Windows
sys.stdout.reconfigure(encoding='utf-8')

from backend.app.database import engine, Base, SessionLocal
from backend.app.models import Voice, DubbingTask
from backend.app.services.voice_service import seed_default_voices, get_all_voices, create_cloned_voice
from backend.app.services.timeline_aligner import TimelineAligner

def test_backend():
    print("=== 1. KIỂM TRA SQLITE DATABASE ===")
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    seed_default_voices(db)

    voices = get_all_voices(db)
    print(f"Tổng số giọng trong SQLite: {len(voices)}")
    for v in voices:
        print(f"  [{v.type.upper()}] ID: {v.id:<10} | Tên: {v.name:<15} | Mô tả: {v.description}")

    print("\n=== 2. THỬ NGHIỆM TẠO GIỌNG CLONE (CUSTOM VOICE) ===")
    # Tạo audio giả lập 5 giây để test lưu file & metadata
    dummy_wav_bytes = b"RIFF....WAVEfmt ...." + b"\x00" * 1000
    cloned = create_cloned_voice(
        db=db,
        name="Giọng Reviewer Kể Chuyện",
        description="Giọng review phim nam trầm, nhái theo mẫu âm thanh",
        file_bytes=dummy_wav_bytes,
        original_filename="sample_voice.wav"
    )
    print(f"Đã tạo giọng clone thành công: ID={cloned.id}, Tên={cloned.name}, Path={cloned.ref_audio_path}")

    # Đọc lại danh sách sau khi thêm clone
    voices_updated = get_all_voices(db)
    print(f"Tổng số giọng sau khi clone: {len(voices_updated)}")

    print("\n=== 3. KIỂM TRA THUẬT TOÁN ĐỒNG BỘ TIMELINE (SEQUENTIAL ALIGNMENT) ===")
    sample_segments = [
        {"id": 1, "start": 1.0, "end": 3.0, "text": "Hello world", "audio_duration": 3.5},  # Đọc 3.5s -> xong lúc 4.5s
        {"id": 2, "start": 3.5, "end": 5.0, "text": "Second sentence", "audio_duration": 2.0}, # Gốc 3.5s, nhưng câu 1 xong lúc 4.5s -> phải dời sang 4.5s!
        {"id": 3, "start": 8.0, "end": 10.0, "text": "Third sentence", "audio_duration": 1.5}  # Gốc 8.0s, câu 2 xong lúc 6.5s -> bắt đầu đúng 8.0s!
    ]
    aligned = TimelineAligner.align_segments(sample_segments)
    for seg in aligned:
        print(f"  Câu {seg['id']}: Gốc [{seg['start']}s -> {seg['end']}s] | Sau căn chỉnh: [{seg['actual_start']}s -> {seg['actual_end']}s] (Độ dài: {seg['audio_duration']}s)")

    print("\n=== KIỂM TRA TOÀN BỘ BACKEND THÀNH CÔNG RỰC RỠ! ===")
    db.close()

if __name__ == "__main__":
    test_backend()
