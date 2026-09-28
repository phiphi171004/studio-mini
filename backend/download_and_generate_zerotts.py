import sys
import os
from pathlib import Path

# Thiết lập UTF-8 encoding cho console Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from zerotts import ZeroTTS
from backend.app.database import SessionLocal
from backend.app.models import Voice
from backend.app.config import STORAGE_DIR

PRESETS_DIR = STORAGE_DIR / "voices" / "presets"
PRESETS_DIR.mkdir(parents=True, exist_ok=True)

SAMPLES = [
    {
        "id": "maichi",
        "text": "Xin chào các bạn, tôi là Mai Chi, giọng đọc truyền cảm và tự nhiên chuẩn miền Bắc."
    },
    {
        "id": "baotrang",
        "text": "Chào bạn, mình là Bảo Trang, giọng đọc nữ trẻ trung, tươi sáng và năng động."
    },
    {
        "id": "kimoanh",
        "text": "Xin chào quý vị, tôi là Kim Oanh, giọng đọc thanh thoát, nhẹ nhàng và tình cảm."
    },
    {
        "id": "hamy",
        "text": "Chào bạn, mình là Hà My, giọng kể chuyện ngọt ngào, sâu lắng và ấm áp."
    },
    {
        "id": "giahuy",
        "text": "Xin chào các bạn, tôi là Gia Huy, giọng đọc nam chững chạc, chuyên tin tức và review."
    },
    {
        "id": "huuduc",
        "text": "Chào mừng các bạn, tôi là Hữu Đức, giọng nam trầm ấm, phù hợp thuyết minh phim tài liệu."
    },
    {
        "id": "quangminh",
        "text": "Xin chào, tôi là Quang Minh, giọng phát thanh viên rõ ràng, chuẩn mực và đĩnh đạc."
    },
    {
        "id": "tiendat",
        "text": "Yo xin chào anh em, mình là Tiến Đạt, giọng đọc năng động chuyên review công nghệ và game."
    }
]

def run():
    print("=" * 60)
    print("  🚀 ĐANG TẢI VÀ KHỞI ĐỘNG MODEL GỐC ZEROTTS (zeroweight-ai/ZeroTTS)")
    print("=" * 60)

    try:
        model = ZeroTTS.from_pretrained("zeroweight-ai/ZeroTTS")
        print("✅ Đã nạp thành công model ZeroTTS!")
    except Exception as e:
        print(f"❌ Lỗi khi tải hoặc nạp ZeroTTS: {e}")
        return

    db = SessionLocal()
    try:
        for item in SAMPLES:
            voice_id = item["id"]
            wav_filename = f"{voice_id}.wav"
            wav_path = PRESETS_DIR / wav_filename
            rel_path = f"storage/voices/presets/{wav_filename}"

            print(f"Đang sinh giọng ZeroTTS cho [{voice_id}]...")
            try:
                audio_array = model.synthesize(text=item["text"], voice=voice_id)
                model.save_audio(audio_array, str(wav_path))

                # Cập nhật đường dẫn vào SQLite
                voice_record = db.query(Voice).filter(Voice.id == voice_id).first()
                if voice_record:
                    voice_record.ref_audio_path = rel_path
                    db.commit()
                print(f"  -> Đã lưu giọng gốc ZeroTTS thành công: {rel_path}")
            except Exception as e:
                print(f"  -> Lỗi sinh giọng {voice_id}: {e}")

        print("\n🎉 HOÀN TẤT TẠO TOÀN BỘ 8 FILE ÂM THANH CHUẨN GỐC ZEROTTS!")
    finally:
        db.close()

if __name__ == "__main__":
    run()
