import asyncio
import os
import sys
from pathlib import Path

# Đảm bảo in tiếng Việt không bị lỗi cp1252 trên Windows console
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

import edge_tts
from backend.app.database import SessionLocal
from backend.app.models import Voice
from backend.app.config import STORAGE_DIR

PRESETS_DIR = STORAGE_DIR / "voices" / "presets"
PRESETS_DIR.mkdir(parents=True, exist_ok=True)

SAMPLES = [
    {
        "id": "maichi",
        "voice": "vi-VN-HoaiMyNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
        "text": "Xin chào, tôi là Mai Chi. Giọng đọc truyền cảm và tự nhiên chuẩn miền Bắc."
    },
    {
        "id": "baotrang",
        "voice": "vi-VN-HoaiMyNeural",
        "rate": "+10%",
        "pitch": "+4Hz",
        "text": "Chào bạn, mình là Bảo Trang. Giọng đọc nữ trẻ trung, tươi sáng và năng động."
    },
    {
        "id": "kimoanh",
        "voice": "vi-VN-HoaiMyNeural",
        "rate": "-5%",
        "pitch": "+2Hz",
        "text": "Xin chào quý vị, tôi là Kim Oanh. Giọng đọc thanh thoát, nhẹ nhàng và tình cảm."
    },
    {
        "id": "hamy",
        "voice": "vi-VN-HoaiMyNeural",
        "rate": "-8%",
        "pitch": "-2Hz",
        "text": "Chào bạn, mình là Hà My. Giọng kể chuyện ngọt ngào, sâu lắng và ấm áp."
    },
    {
        "id": "giahuy",
        "voice": "vi-VN-NamMinhNeural",
        "rate": "+5%",
        "pitch": "+2Hz",
        "text": "Xin chào các bạn, tôi là Gia Huy. Giọng đọc nam chững chạc, chuyên tin tức và review."
    },
    {
        "id": "huuduc",
        "voice": "vi-VN-NamMinhNeural",
        "rate": "-8%",
        "pitch": "-5Hz",
        "text": "Chào mừng các bạn, tôi là Hữu Đức. Giọng nam trầm ấm, phù hợp thuyết minh phim tài liệu."
    },
    {
        "id": "quangminh",
        "voice": "vi-VN-NamMinhNeural",
        "rate": "+0%",
        "pitch": "+0Hz",
        "text": "Xin chào, tôi là Quang Minh. Giọng phát thanh viên rõ ràng, chuẩn mực và đĩnh đạc."
    },
    {
        "id": "tiendat",
        "voice": "vi-VN-NamMinhNeural",
        "rate": "+12%",
        "pitch": "+3Hz",
        "text": "Yo xin chào anh em, mình là Tiến Đạt. Giọng đọc năng động chuyên review công nghệ và game."
    }
]

async def generate_all_samples():
    print("=== BẮT ĐẦU TẠO FILE ÂM THANH MẪU CHO 8 GIỌNG ĐỌC ===")
    db = SessionLocal()
    try:
        for item in SAMPLES:
            file_name = f"{item['id']}.mp3"
            file_path = PRESETS_DIR / file_name
            rel_path = f"storage/voices/presets/{file_name}"

            print(f"Đang tạo audio cho [{item['id']}]...")
            communicate = edge_tts.Communicate(
                text=item["text"],
                voice=item["voice"],
                rate=item["rate"],
                pitch=item["pitch"]
            )
            await communicate.save(str(file_path))

            # Cập nhật đường dẫn audio nghe thử vào SQLite
            voice_record = db.query(Voice).filter(Voice.id == item["id"]).first()
            if voice_record:
                voice_record.ref_audio_path = rel_path
                db.commit()
                print(f"  -> Đã cập nhật vào SQLite: {rel_path}")

        print("\n✅ ĐÃ HOÀN TẤT TẠO TOÀN BỘ 8 FILE ÂM THANH NGHE THỬ!")
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(generate_all_samples())
