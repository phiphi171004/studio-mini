import os
from pathlib import Path

# Thư mục gốc dự án
ROOT_DIR = Path(__file__).resolve().parent.parent.parent

from dotenv import load_dotenv

# Load .env từ thư mục gốc hoặc backend
load_dotenv(ROOT_DIR / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Thư mục lưu trữ media và data
STORAGE_DIR = ROOT_DIR / "storage"
VOICES_DIR = STORAGE_DIR / "voices"
UPLOADS_DIR = STORAGE_DIR / "uploads"
TEMP_DIR = STORAGE_DIR / "temp"
OUTPUTS_DIR = STORAGE_DIR / "outputs"

# Đảm bảo các thư mục luôn tồn tại
for folder in [STORAGE_DIR, VOICES_DIR, UPLOADS_DIR, TEMP_DIR, OUTPUTS_DIR]:
    folder.mkdir(parents=True, exist_ok=True)

# Cấu hình SQLite
DB_PATH = STORAGE_DIR / "app.db"
DATABASE_URL = f"sqlite:///{DB_PATH}"

# Danh sách các giọng mẫu chuẩn tuyển chọn của VieNeu-TTS (hỗ trợ Bắc, Trung, Nam, Nam & Nữ)
DEFAULT_PRESET_VOICES = [
    {"id": "mai_anh", "name": "Mai Anh", "description": "⭐ Nữ - Bắc: Phong cách tin tức, review công nghệ (Chuẩn, sắc nét)"},
    {"id": "truc_ly", "name": "Trúc Ly", "description": "⭐ Nữ - Bắc: Phong cách tự nhiên, trong trẻo, sinh động"},
    {"id": "ngoc_huyen", "name": "Ngọc Huyền", "description": "⭐ Nữ - Bắc: Giọng đọc tự nhiên, thanh thoát, êm ái"},
    {"id": "thuy_dung", "name": "Thùy Dung", "description": "⭐ Nữ - Nam: Phong cách tin tức, sắc sảo, cuốn hút"},
    {"id": "thuc_doan", "name": "Thục Đoan", "description": "Nữ - Nam: Phong cách kể chuyện, dịu dàng, ngọt ngào"},
    {"id": "quynh_anh", "name": "Quỳnh Anh", "description": "Nữ - Bắc: Phong cách đọc truyện, truyền cảm"},
    {"id": "minh_quan", "name": "Minh Quân Pro", "description": "⭐ Nam - Bắc: Phong cách tự nhiên, review công nghệ, hiện đại"},
    {"id": "anh_khoi", "name": "Anh Khôi", "description": "⭐ Nam - Bắc: Phong cách kể chuyện, truyền cảm, cuốn hút"},
    {"id": "pham_tuyen", "name": "Phạm Tuyên", "description": "Nam - Bắc: Phong cách tự nhiên, chững chạc, tin cậy"},
    {"id": "thai_son", "name": "Thái Sơn", "description": "Nam - Nam: Phong cách kể chuyện, nam tính, ấm áp"},
    {"id": "minh_triet", "name": "Minh Triết", "description": "Nam - Nam: Phong cách tin tức, sắc nét"},
    {"id": "quang_son", "name": "Quang Sơn", "description": "⭐ Nam - Trung: Phong cách tự nhiên, phóng khoáng"},
]

# Cấu hình AI Dịch Thuật Google Gemini (chuẩn Document-Level SRT)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", os.getenv("GOOGLE_API_KEY", ""))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
GEMINI_BASE_URL = os.getenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com").rstrip("/")

# AI Translate config (đồng bộ với Gemini)
AI_TRANSLATE_BASE_URL = os.getenv("AI_TRANSLATE_BASE_URL", GEMINI_BASE_URL).rstrip("/")
AI_TRANSLATE_API_KEY = os.getenv("AI_TRANSLATE_API_KEY", GEMINI_API_KEY)
AI_TRANSLATE_MODEL = os.getenv("AI_TRANSLATE_MODEL", GEMINI_MODEL)

# Cấu hình Groq Cloud STT (Whisper Large-v3 siêu tốc & chính xác tuyệt đối 100%)
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_WHISPER_MODEL = os.getenv("GROQ_WHISPER_MODEL", "whisper-large-v3")

# Legacy compatibility
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")


