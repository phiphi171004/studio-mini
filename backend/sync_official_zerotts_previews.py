import shutil
import os
import sys
from pathlib import Path

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

from zerotts import ZeroTTS
from backend.app.database import SessionLocal
from backend.app.models import Voice
from backend.app.config import STORAGE_DIR

def sync_previews():
    print("=== ĐỒNG BỘ 8 FILE PREVIEW.WAV CHÍNH GỐC CỦA ZEROTTS ===")
    model = ZeroTTS.from_pretrained("zeroweight-ai/ZeroTTS")
    presets_dir = STORAGE_DIR / "voices" / "presets"
    presets_dir.mkdir(parents=True, exist_ok=True)

    voices_list = ["baotrang", "giahuy", "hamy", "huuduc", "kimoanh", "maichi", "quangminh", "tiendat"]
    db = SessionLocal()
    try:
        for v in voices_list:
            src = model.voices_root / v / "preview.wav"
            dst = presets_dir / f"{v}.wav"
            shutil.copy2(src, dst)
            rel_path = f"storage/voices/presets/{v}.wav"
            
            # Cập nhật SQLite
            db.query(Voice).filter(Voice.id == v).update({"ref_audio_path": rel_path})
            print(f"✅ Đã chép file gốc ZeroTTS cho [{v}]: {dst.name} ({dst.stat().st_size} bytes)")

        db.commit()
        print("\n🎉 ĐÃ CẬP NHẬT HOÀN TOÀN 8 FILE GỐC 100% CỦA ZEROTTS VÀO DATABASE!")
    finally:
        db.close()

if __name__ == "__main__":
    sync_previews()
