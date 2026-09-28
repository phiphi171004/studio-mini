import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

import uuid
import threading
from pathlib import Path
from typing import List, Optional, Dict, Any
from pydantic import BaseModel
from fastapi import FastAPI, UploadFile, File, Form, Body, Depends, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session


from fastapi.responses import FileResponse, Response
from .config import UPLOADS_DIR, STORAGE_DIR, ROOT_DIR, OUTPUTS_DIR
from .database import engine, Base, get_db
from .models import Voice, DubbingTask
from .schemas import VoiceResponse, DubbingTaskResponse
from .services.voice_service import seed_default_voices, get_all_voices, get_voice, create_cloned_voice, delete_voice
from .pipeline import run_dubbing_pipeline, cleanup_task_resources, auto_prune_storage

# Khởi tạo các bảng trong SQLite
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Studio Mini - AI Dubbing API",
    description="Backend API cho Web App Lồng Tiếng AI Tự Động (SQLite + FastAPI)",
    version="1.0.0"
)

# CORS Middleware cho phép kết nối từ mọi frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount thư mục lưu trữ file video, audio
app.mount("/storage", StaticFiles(directory=str(STORAGE_DIR)), name="storage")


def auto_migrate_db():
    """Tự động bổ sung các cột mới vào SQLite nếu chưa có."""
    from sqlalchemy import text
    with engine.connect() as conn:
        for col_name, col_type in [
            ("original_srt_path", "VARCHAR(512)"),
            ("translated_srt_path", "VARCHAR(512)"),
            ("remove_subtitles", "BOOLEAN DEFAULT 1"),
            ("auto_inplace_overlay", "BOOLEAN DEFAULT 0"),
        ]:
            try:
                conn.execute(text(f"ALTER TABLE dubbing_tasks ADD COLUMN {col_name} {col_type}"))
                conn.commit()
            except Exception:
                pass

@app.on_event("startup")
def on_startup():
    """Khởi tạo dữ liệu mẫu và cập nhật cấu trúc database khi backend bắt đầu chạy."""
    auto_migrate_db()
    from .database import SessionLocal
    db = SessionLocal()
    try:
        # Tự động dọn dẹp các tác vụ cũ bị gián đoạn do tắt app trước đó
        stale_tasks = db.query(DubbingTask).filter(DubbingTask.status.in_(["processing", "queued"])).all()
        for st in stale_tasks:
            st.status = "failed"
            st.error_message = "Tác vụ đã dừng khi tắt ứng dụng."
        db.commit()
        seed_default_voices(db)
        
        # Tự động dọn dẹp storage khi khởi động (chỉ giữ 2 video gần nhất)
        auto_prune_storage(keep_count=2)
    finally:
        db.close()

# ==========================================
# 1. API QUẢN LÝ KHO GIỌNG ĐỌC (VOICE BANK)
# ==========================================

@app.get("/api/voices", response_model=List[VoiceResponse], summary="Lấy danh sách giọng đọc")
def list_voices(db: Session = Depends(get_db)):
    """Trả về toàn bộ 8 giọng mẫu có sẵn và các giọng đã clone."""
    return get_all_voices(db)

@app.post("/api/voices/clone", response_model=VoiceResponse, summary="Upload file ghi âm để clone giọng mới")
async def clone_voice(
    name: str = Form(..., description="Tên gợi nhớ cho giọng (VD: Giọng Reviewer A)"),
    description: str = Form("", description="Mô tả đặc điểm giọng"),
    audio_file: UploadFile = File(..., description="File audio sạch thời lượng 3-30s"),
    db: Session = Depends(get_db)
):
    """
    Tiếp nhận file ghi âm mẫu, lưu file vào storage/voices/
    và tạo bản ghi giọng đọc mới trong SQLite.
    """
    file_bytes = await audio_file.read()
    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="File audio tải lên rỗng.")

    voice = create_cloned_voice(
        db=db,
        name=name,
        description=description,
        file_bytes=file_bytes,
        original_filename=audio_file.filename
    )
    return voice

@app.delete("/api/voices/{voice_id}", summary="Xóa một giọng đã clone")
def remove_voice(voice_id: str, db: Session = Depends(get_db)):
    """Chỉ xóa được giọng clone cá nhân, không xóa giọng preset của hệ thống."""
    try:
        success = delete_voice(db, voice_id)
        if not success:
            raise HTTPException(status_code=404, detail="Không tìm thấy giọng cần xóa.")
        return {"message": "Đã xóa giọng thành công."}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

# ==========================================
# 2. API PIPELINE LỒNG TIẾNG VIDEO
# ==========================================

@app.post("/api/dubbing/start", response_model=DubbingTaskResponse, summary="Upload video và bắt đầu lồng tiếng")
async def start_dubbing(
    background_tasks: BackgroundTasks,
    video_file: UploadFile = File(..., description="File video gốc cần lồng tiếng"),
    voice_id: str = Form(..., description="Mã giọng đọc đã chọn từ kho giọng"),
    remove_subtitles: bool = Form(True, description="Tự động xóa phụ đề/chữ gốc cũ trên video"),
    subtitle_removal_mode: str = Form("auto", description="Phương thức xóa phụ đề: 'auto' hoặc 'manual'"),
    manual_regions: Optional[str] = Form(None, description="JSON string chứa danh sách vùng xóa thủ công (nếu mode=manual)"),
    burn_subtitles: bool = Form(False, description="Chèn phụ đề mới trực tiếp vào video thành phẩm"),
    auto_inplace_overlay: bool = Form(False, description="Tự động phát hiện mọi chữ trên video và tạo thẻ đè tại chỗ"),
    inplace_style: Optional[str] = Form(None, description="Cấu hình style đè tại chỗ (cỡ chữ, màu chữ, màu nền, preset) dạng JSON"),
    subtitle_y: float = Form(0.78, description="Tọa độ Y của khung phụ đề (0.0 - 1.0)"),
    subtitle_h: float = Form(0.14, description="Chiều cao khung phụ đề (0.0 - 1.0)"),
    subtitle_color: str = Form("yellow", description="Màu chữ phụ đề (yellow, white, cyan)"),
    custom_srt_file: Optional[UploadFile] = File(None, description="File phụ đề .SRT có sẵn từ CapCut (tùy chọn)"),
    ai_api_key: Optional[str] = Form(None, description="API Key dịch thuật AI (tùy chọn)"),
    ai_base_url: Optional[str] = Form(None, description="Base URL dịch thuật (tùy chọn)"),
    ai_model: Optional[str] = Form(None, description="Model dịch thuật AI (tùy chọn)"),
    groq_api_key: Optional[str] = Form(None, description="API Key Groq Whisper Cloud (tùy chọn)"),
    db: Session = Depends(get_db)
):
    """
    Nhận video + giọng đọc, tạo task trong SQLite và khởi chạy tiến trình ngầm (Background Task).
    """
    voice = get_voice(db, voice_id)
    if not voice:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy giọng đọc với mã '{voice_id}'.")

    # Nếu người dùng truyền API Key từ UI, cập nhật config runtime
    from . import config
    if ai_api_key:
        config.AI_TRANSLATE_API_KEY = ai_api_key.strip()
    if ai_base_url:
        config.AI_TRANSLATE_BASE_URL = ai_base_url.strip().rstrip("/")
    if ai_model:
        config.AI_TRANSLATE_MODEL = ai_model.strip()
    if groq_api_key:
        config.GROQ_API_KEY = groq_api_key.strip()

    task_id = f"task_{uuid.uuid4().hex[:10]}"
    ext = Path(video_file.filename).suffix.lower() or ".mp4"
    saved_video_path = UPLOADS_DIR / f"{task_id}{ext}"

    # Lưu video tải lên
    video_bytes = await video_file.read()
    with open(saved_video_path, "wb") as f:
        f.write(video_bytes)

    # Dọn dẹp các video upload cũ hơn 2 video gần nhất
    auto_prune_storage(keep_count=2)

    # Lưu file SRT tùy chỉnh nếu có
    saved_srt_path = None
    if custom_srt_file and custom_srt_file.filename:
        try:
            srt_bytes = await custom_srt_file.read()
            if len(srt_bytes) > 10:
                saved_srt_path = UPLOADS_DIR / f"{task_id}_custom.srt"
                with open(saved_srt_path, "wb") as f:
                    f.write(srt_bytes)
                print(f"[Main] 🎯 Đã lưu file phụ đề tùy chỉnh: {custom_srt_file.filename} -> {saved_srt_path}")
        except Exception as err:
            print(f"[Main] Lỗi đọc file phụ đề tùy chỉnh: {err}")

    # Khởi tạo bản ghi task trong SQLite
    task = DubbingTask(
        id=task_id,
        video_filename=video_file.filename,
        input_video_path=str(saved_video_path),
        voice_id=voice_id,
        remove_subtitles=remove_subtitles,
        auto_inplace_overlay=auto_inplace_overlay,
        status="queued",
        current_step="queued",
        progress=0
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    # Parse manual_regions nếu có
    parsed_regions = None
    if manual_regions:
        try:
            import json
            parsed_regions = json.loads(manual_regions)
        except Exception as e:
            print(f"[Main] Lỗi parse manual_regions: {e}")

    # Parse inplace_style nếu có
    parsed_inplace_style = None
    if inplace_style:
        try:
            import json
            parsed_inplace_style = json.loads(inplace_style)
        except Exception as e:
            print(f"[Main] Lỗi parse inplace_style: {e}")

    # Khởi chạy pipeline trên Thread riêng biệt, giải phóng 100% asyncio event loop
    srt_arg = str(saved_srt_path) if saved_srt_path else None
    def _run_worker(
        tid: str,
        srt_file_path: Optional[str],
        remove_subs: bool,
        sub_mode: str,
        regions: Optional[List[dict]],
        burn_subs: bool,
        inplace_overlay: bool,
        sub_y: float,
        sub_h: float,
        sub_color: str,
        style_cfg: Optional[dict]
    ):
        import asyncio
        asyncio.run(run_dubbing_pipeline(
            tid,
            custom_srt_path=srt_file_path,
            remove_subtitles=remove_subs,
            subtitle_removal_mode=sub_mode,
            manual_regions=regions,
            burn_subtitles=burn_subs,
            auto_inplace_overlay=inplace_overlay,
            subtitle_y=sub_y,
            subtitle_h=sub_h,
            subtitle_color=sub_color,
            inplace_style=style_cfg
        ))

    threading.Thread(
        target=_run_worker,
        args=(task_id, srt_arg, remove_subtitles, subtitle_removal_mode, parsed_regions, burn_subtitles, auto_inplace_overlay, subtitle_y, subtitle_h, subtitle_color, parsed_inplace_style),
        daemon=True
    ).start()

    return task

@app.get("/api/dubbing/latest", response_model=Optional[DubbingTaskResponse], summary="Lấy tác vụ lồng tiếng gần nhất")
def get_latest_task(db: Session = Depends(get_db)):
    """Trả về tác vụ gần nhất để frontend tự khôi phục tiến trình khi mở app."""
    return db.query(DubbingTask).order_by(DubbingTask.created_at.desc()).first()

@app.get("/api/dubbing/{task_id}", response_model=DubbingTaskResponse, summary="Xem tiến độ và kết quả lồng tiếng")
def get_task_status(task_id: str, db: Session = Depends(get_db)):
    """Trả về trạng thái, % tiến trình và đường dẫn video hoàn thành từ SQLite."""
    task = db.query(DubbingTask).filter(DubbingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ lồng tiếng này.")
    return task

@app.post("/api/dubbing/{task_id}/cancel", summary="Hủy hoặc đặt lại tác vụ lồng tiếng")
def cancel_dubbing_task(task_id: str, db: Session = Depends(get_db)):
    """Hủy tác vụ đang chạy hoặc bị treo để người dùng bắt đầu tác vụ mới và dọn dẹp file tạm."""
    task = db.query(DubbingTask).filter(DubbingTask.id == task_id).first()
    if task:
        task.status = "failed"
        task.error_message = "Người dùng đã hủy tác vụ."
        db.commit()
        try:
            from .config import TEMP_DIR
            cleanup_task_resources(
                TEMP_DIR / task_id,
                Path(task.input_video_path) if task.input_video_path else None
            )
        except Exception:
            pass
    return {"status": "cancelled", "task_id": task_id}

class CaptionRequest(BaseModel):
    style: str = "viral"
    custom_instructions: Optional[str] = None

@app.post("/api/dubbing/{task_id}/caption", summary="Tạo Caption Fanpage Facebook bằng Google Gemini")
async def generate_task_caption(task_id: str, req: CaptionRequest = Body(...), db: Session = Depends(get_db)):
    """
    Dựa trên kịch bản video đã lồng tiếng, gọi Google Gemini để tạo tiêu đề giật tít,
    bài viết mô tả Fanpage cuốn hút và bộ hashtag chuẩn SEO.
    """
    task = db.query(DubbingTask).filter(DubbingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ lồng tiếng.")

    # Thu thập kịch bản tiếng Việt
    transcript_text = ""
    if task.segments_data and isinstance(task.segments_data, list):
        lines = []
        for s in task.segments_data:
            t = s.get("translated_text") or s.get("text") or ""
            if t.strip():
                lines.append(t.strip())
        transcript_text = "\n".join(lines)

    if not transcript_text and task.translated_srt_path:
        srt_file = Path(task.translated_srt_path)
        if not srt_file.is_absolute():
            srt_file = ROOT_DIR / srt_file
        if srt_file.exists():
            try:
                content = srt_file.read_text(encoding="utf-8", errors="ignore")
                for line in content.splitlines():
                    line = line.strip()
                    if line and not line.isdigit() and "-->" not in line:
                        transcript_text += line + "\n"
            except Exception:
                pass

    if not transcript_text:
        raise HTTPException(status_code=400, detail="Chưa có dữ liệu kịch bản phụ đề để tạo caption.")

    try:
        from .services.caption_generator import CaptionGeneratorService
        res = await CaptionGeneratorService.generate_fanpage_caption(
            transcript_text=transcript_text,
            style=req.style,
            custom_instructions=req.custom_instructions
        )
        return res
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Lỗi tạo caption từ Gemini: {str(e)}")

class CommentRequest(BaseModel):
    affiliate_link: str = ""
    custom_instructions: Optional[str] = None

@app.post("/api/dubbing/{task_id}/comment", summary="Tạo Comment ghim gắn link tiếp thị bằng Google Gemini")
async def generate_task_affiliate_comment(task_id: str, req: CommentRequest = Body(...), db: Session = Depends(get_db)):
    """
    Dựa trên kịch bản video và link tiếp thị liên kết, tạo các đoạn comment ghim chuyển đổi mua hàng.
    """
    task = db.query(DubbingTask).filter(DubbingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ lồng tiếng.")

    transcript_text = ""
    if task.segments_data and isinstance(task.segments_data, list):
        lines = []
        for s in task.segments_data:
            t = s.get("translated_text") or s.get("text") or ""
            if t.strip():
                lines.append(t.strip())
        transcript_text = "\n".join(lines)

    if not transcript_text and task.translated_srt_path:
        srt_file = Path(task.translated_srt_path)
        if not srt_file.is_absolute():
            srt_file = ROOT_DIR / srt_file
        if srt_file.exists():
            try:
                content = srt_file.read_text(encoding="utf-8", errors="ignore")
                for line in content.splitlines():
                    line = line.strip()
                    if line and not line.isdigit() and "-->" not in line:
                        transcript_text += line + "\n"
            except Exception:
                pass

    if not transcript_text:
        raise HTTPException(status_code=400, detail="Chưa có dữ liệu kịch bản phụ đề để tạo comment.")

    try:
        from .services.caption_generator import CaptionGeneratorService
        res = await CaptionGeneratorService.generate_affiliate_comments(
            transcript_text=transcript_text,
            affiliate_link=req.affiliate_link,
            custom_instructions=req.custom_instructions
        )
        return res
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Lỗi tạo comment từ Gemini: {str(e)}")

# ==========================================
# 3. API CẤU HÌNH AI DỊCH THUẬT & GROQ WHISPER STT
# ==========================================

@app.get("/api/settings/ai", summary="Lấy thông tin cấu hình AI dịch thuật, Gemini Reviewer và Groq STT hiện tại")
def get_ai_settings():
    from . import config
    masked_key = ""
    if config.AI_TRANSLATE_API_KEY:
        k = config.AI_TRANSLATE_API_KEY.strip()
        masked_key = f"{k[:4]}...{k[-4:]}" if len(k) > 8 else "***"
    
    masked_groq_key = ""
    if config.GROQ_API_KEY:
        g = config.GROQ_API_KEY.strip()
        masked_groq_key = f"{g[:4]}...{g[-4:]}" if len(g) > 8 else "***"

    masked_gemini_key = ""
    if config.GEMINI_API_KEY:
        m = config.GEMINI_API_KEY.strip()
        masked_gemini_key = f"{m[:4]}...{m[-4:]}" if len(m) > 8 else "***"

    return {
        "gemini_model": config.GEMINI_MODEL,
        "has_gemini_key": bool(config.GEMINI_API_KEY),
        "masked_gemini_key": masked_gemini_key,
        "has_groq_key": bool(config.GROQ_API_KEY),
        "masked_groq_key": masked_groq_key,
        "groq_model": config.GROQ_WHISPER_MODEL,
        # Đồng bộ các trường cũ sang Gemini
        "has_key": bool(config.GEMINI_API_KEY),
        "masked_key": masked_gemini_key,
        "model": config.GEMINI_MODEL,
        "base_url": config.GEMINI_BASE_URL,
        "gemini_base_url": config.GEMINI_BASE_URL
    }

@app.post("/api/settings/ai", summary="Lưu cấu hình AI dịch thuật Gemini và Groq STT vào hệ thống và .env")
def save_ai_settings(
    api_key: str = Form(""),
    base_url: str = Form("https://generativelanguage.googleapis.com"),
    model: str = Form("gemini-3.5-flash-lite"),
    groq_api_key: str = Form(""),
    gemini_api_key: str = Form(""),
    gemini_model: str = Form("gemini-3.5-flash-lite"),
    gemini_base_url: str = Form("https://generativelanguage.googleapis.com")
):
    from . import config
    # Ưu tiên Gemini làm bộ máy dịch thuật duy nhất
    chosen_key = gemini_api_key.strip() or api_key.strip()
    chosen_model = gemini_model.strip() or model.strip() or "gemini-3.5-flash-lite"
    chosen_base = gemini_base_url.strip().rstrip("/") or "https://generativelanguage.googleapis.com"

    if chosen_key and "..." not in chosen_key:
        config.GEMINI_API_KEY = chosen_key
        config.AI_TRANSLATE_API_KEY = chosen_key
    config.GEMINI_MODEL = chosen_model
    config.AI_TRANSLATE_MODEL = chosen_model
    config.GEMINI_BASE_URL = chosen_base
    config.AI_TRANSLATE_BASE_URL = chosen_base

    if groq_api_key.strip() and "..." not in groq_api_key:
        config.GROQ_API_KEY = groq_api_key.strip()

    # Ghi lại vào file .env tại thư mục gốc
    env_file = ROOT_DIR / ".env"
    env_content = (
        f"# Studio Mini - Cấu hình AI Dịch Thuật & Phụ Đề (Google Gemini)\n"
        f"GEMINI_API_KEY={config.GEMINI_API_KEY}\n"
        f"GEMINI_MODEL={config.GEMINI_MODEL}\n"
        f"GEMINI_BASE_URL={config.GEMINI_BASE_URL}\n"
        f"AI_TRANSLATE_API_KEY={config.AI_TRANSLATE_API_KEY}\n"
        f"AI_TRANSLATE_MODEL={config.AI_TRANSLATE_MODEL}\n"
        f"AI_TRANSLATE_BASE_URL={config.AI_TRANSLATE_BASE_URL}\n"
        f"GROQ_API_KEY={config.GROQ_API_KEY}\n"
        f"GROQ_WHISPER_MODEL={config.GROQ_WHISPER_MODEL}\n"
    )
    with open(env_file, "w", encoding="utf-8") as f:
        f.write(env_content)

    return {
        "status": "ok",
        "message": "Đã lưu cấu hình Google Gemini dịch thuật thành công!",
        "has_key": bool(config.GEMINI_API_KEY or config.AI_TRANSLATE_API_KEY),
        "has_groq_key": bool(config.GROQ_API_KEY),
        "has_gemini_key": bool(config.GEMINI_API_KEY),
        "model": config.GEMINI_MODEL,
        "gemini_model": config.GEMINI_MODEL
    }


@app.post("/api/settings/ai/test", summary="Kiểm tra kết nối và thử dịch SRT bằng Google Gemini")
async def test_ai_settings(
    api_key: Optional[str] = Form(None),
    base_url: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    gemini_api_key: Optional[str] = Form(None),
    gemini_model: Optional[str] = Form(None),
    gemini_base_url: Optional[str] = Form(None)
):
    from .services.translator import TranslatorService
    test_segments = [
        {"id": 1, "text": "今天给大家推荐这个海绵擦", "start": 0.0, "end": 1.5},
        {"id": 2, "text": "他吸水性特别强，一擦油污就干净了", "start": 1.6, "end": 3.8}
    ]
    try:
        results = await TranslatorService.translate_segments(
            segments=test_segments,
            target_lang="vi",
            api_key=api_key,
            base_url=base_url,
            model=model,
            gemini_api_key=gemini_api_key,
            gemini_model=gemini_model,
            gemini_base_url=gemini_base_url
        )
        if results and "translated_text" in results[0]:
            return {
                "status": "success",
                "original": [s["text"] for s in test_segments],
                "translation": [s["translated_text"] for s in results]
            }
        else:
            raise RuntimeError("Không nhận được bản dịch phản hồi từ API.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Kiểm tra thất bại: {str(e)}")


@app.post("/api/settings/ai/test-gemini", summary="Kiểm tra kết nối riêng Google Gemini Reviewer")
async def test_gemini_reviewer(
    api_key: str = Form(...),
    model: str = Form("gemini-3.5-flash-lite"),
    base_url: str = Form("https://generativelanguage.googleapis.com/v1beta/openai")
):
    import httpx
    test_segments = [
        {"id": 1, "text": "直接", "translated_text": "luôn", "start": 0.0, "end": 0.5},
        {"id": 2, "text": "放进洗碗机就行", "translated_text": "bỏ vào máy rửa bát là xong", "start": 0.6, "end": 1.8}
    ]
    try:
        endpoint = "https://generativelanguage.googleapis.com/v1beta/interactions"
        payload = {
            "model": f"models/{model.strip()}",
            "input": (
                "Bạn là biên tập viên kịch bản. Hãy biên tập lại câu sau và trả về JSON:\n"
                '[{"id":1,"original":"直接","draft":"luôn"},{"id":2,"original":"放进洗碗机就行","draft":"bỏ vào máy rửa bát là xong"}]\n\n'
                'Trả về JSON mảng: [{"id":1,"translated_text":"..."}, {"id":2,"translated_text":"..."}]'
            )
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key.strip(),
            "Api-Revision": "2026-05-20"
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(endpoint, json=payload, headers=headers)
        if res.status_code != 200:
            raise RuntimeError(f"Gemini API returned status {res.status_code}: {res.text}")
        res_json = res.json()
        # Parse tu steps[type=model_output].content[0].text
        output_text = ""
        for step in res_json.get("steps", []):
            if step.get("type") == "model_output":
                parts = step.get("content", [])
                if parts and isinstance(parts[0], dict):
                    output_text = parts[0].get("text", "")
                elif parts and isinstance(parts[0], str):
                    output_text = parts[0]
                break
        if not output_text:
            output_text = res_json.get("output_text") or res_json.get("output") or ""
        return {
            "status": "success",
            "model": model.strip(),
            "before": [s["translated_text"] for s in test_segments],
            "raw_response": output_text[:500]
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Kiểm tra Gemini thất bại: {str(e)}")


@app.get("/api/health", summary="Kiểm tra trạng thái máy chủ")
def health_check():
    return {"status": "ok", "message": "Studio Mini AI Dubbing API đang hoạt động bình thường."}


# ==========================================
# 4. API XÓA PHỤ ĐỀ / WATERMARK TRÊN VIDEO
# ==========================================
import json
from .services.subtitle_remover import (
    generate_preview_frame,
    process_video_removal,
    remover_tasks,
    get_video_dimensions
)

@app.post("/api/subtitle-remover/preview", summary="Tạo ảnh xem trước 1 khung hình sau khi xóa chữ AI")
async def preview_subtitle_removal(
    video_file: Optional[UploadFile] = File(None),
    video_path: Optional[str] = Form(None),
    boxes: str = Form("[]"),
    auto_detect: bool = Form(True),
    timestamp: float = Form(1.0)
):
    try:
        saved_video_path = None
        if video_file and video_file.filename:
            ext = Path(video_file.filename).suffix.lower() or ".mp4"
            filename = f"subrem_temp_{uuid.uuid4().hex[:8]}{ext}"
            saved_video_path = UPLOADS_DIR / filename
            content = await video_file.read()
            with open(saved_video_path, "wb") as f:
                f.write(content)
            auto_prune_storage(keep_count=2)
        elif video_path:
            p = Path(video_path)
            if not p.is_absolute():
                p = ROOT_DIR / video_path
            if p.exists():
                saved_video_path = p
        
        if not saved_video_path or not saved_video_path.exists():
            raise HTTPException(status_code=400, detail="Không tìm thấy file video để xem trước.")

        try:
            parsed_boxes = json.loads(boxes)
        except Exception:
            parsed_boxes = []

        vw, vh, _, _ = get_video_dimensions(saved_video_path)
        preview_res = generate_preview_frame(
            saved_video_path,
            boxes=parsed_boxes,
            auto_detect=auto_detect,
            timestamp_sec=timestamp
        )

        rel_path = f"storage/uploads/{saved_video_path.name}" if "uploads" in str(saved_video_path) else str(saved_video_path)
        return {
            "status": "success",
            "preview_image": preview_res.get("image"),
            "detected_texts": preview_res.get("detected_texts", []),
            "video_path": rel_path,
            "video_width": vw,
            "video_height": vh,
            "timestamp": timestamp
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi tạo bản xem trước: {str(e)}")

@app.post("/api/subtitle-remover/start", summary="Bắt đầu tiến trình xóa chữ AI trên toàn bộ video")
async def start_subtitle_removal(
    video_file: Optional[UploadFile] = File(None),
    video_path: Optional[str] = Form(None),
    boxes: str = Form("[]"),
    auto_detect: bool = Form(True)
):
    try:
        saved_video_path = None
        orig_name = "video.mp4"
        if video_file and video_file.filename:
            orig_name = video_file.filename
            ext = Path(video_file.filename).suffix.lower() or ".mp4"
            filename = f"subrem_{uuid.uuid4().hex[:8]}{ext}"
            saved_video_path = UPLOADS_DIR / filename
            content = await video_file.read()
            with open(saved_video_path, "wb") as f:
                f.write(content)
            auto_prune_storage(keep_count=2)
        elif video_path:
            p = Path(video_path)
            if not p.is_absolute():
                p = ROOT_DIR / video_path
            if p.exists():
                saved_video_path = p
                orig_name = p.name

        if not saved_video_path or not saved_video_path.exists():
            raise HTTPException(status_code=400, detail="Không tìm thấy file video đầu vào.")

        try:
            parsed_boxes = json.loads(boxes)
        except Exception:
            parsed_boxes = []

        if not auto_detect and not parsed_boxes:
            raise HTTPException(status_code=400, detail="Vui lòng bật Chế độ Tự Động hoặc chọn ít nhất 1 vùng cần xóa.")

        task_id = f"rem_{uuid.uuid4().hex[:8]}"
        out_filename = f"{Path(orig_name).stem}_clean_{task_id}.mp4"
        output_path = OUTPUTS_DIR / out_filename

        # Chạy tiến trình xóa ngầm trên Thread riêng
        def _run_worker(tid: str, inp: Path, outp: Path, bxs: list, auto: bool):
            import asyncio
            try:
                asyncio.run(process_video_removal(tid, inp, outp, boxes=bxs, auto_detect=auto, progress_dict=remover_tasks))
            finally:
                # Xóa video upload tạm khi xóa phụ đề hoàn thành
                try:
                    if inp and inp.exists() and "uploads" in str(inp):
                        inp.unlink(missing_ok=True)
                        print(f"[SubtitleRemover] Đã giải phóng video upload tạm: {inp.name}")
                except Exception:
                    pass
                auto_prune_storage(keep_count=2)

        threading.Thread(target=_run_worker, args=(task_id, saved_video_path, output_path, parsed_boxes, auto_detect), daemon=True).start()

        return {
            "task_id": task_id,
            "status": "processing",
            "output_filename": out_filename
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể khởi chạy xóa chữ: {str(e)}")

@app.get("/api/subtitle-remover/status/{task_id}", summary="Lấy tiến độ xóa chữ video")
def get_subtitle_remover_status(task_id: str):
    task = remover_tasks.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Không tìm thấy tác vụ xóa chữ này.")
    return task

@app.post("/api/subtitle-remover/warmup", summary="Tải ngầm mô hình AI Xóa Chữ")
def warmup_subtitle_remover(background_tasks: BackgroundTasks):
    from .services.subtitle_remover import SubtitleRemoverService
    background_tasks.add_task(SubtitleRemoverService.warmup)
    return {"status": "warming_up", "message": "Mô hình LaMa & OCR đang được nạp ngầm lên GPU"}

@app.post("/api/system/cleanup-vram", summary="Dọn dẹp và giải phóng bộ nhớ GPU VRAM")
def cleanup_gpu_vram():
    from .services.subtitle_remover import SubtitleRemoverService
    SubtitleRemoverService.release_resources()
# ==========================================
# 5. API TẢI VIDEO TỪ MẠNG XÃ HỘI (DOUYIN, TIKTOK, BILIBILI,...)
# ==========================================
class VideoInfoRequest(BaseModel):
    url: str

class VideoDownloadRequest(BaseModel):
    video_url: str
    title: Optional[str] = ""
    platform: Optional[str] = ""

@app.post("/api/downloader/info", summary="Lấy link trực tiếp và thông tin video từ Douyin, TikTok, Xiaohongshu, Kuaishou, Bilibili")
async def get_video_download_info(req: VideoInfoRequest):
    from .services.video_downloader import fetch_video_info
    try:
        info = await fetch_video_info(req.url)
        return info
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except RuntimeError as re:
        raise HTTPException(status_code=422, detail=str(re))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Không thể phân tích video: {str(e)}")

@app.get("/api/downloader/proxy-image", summary="Proxy ảnh thumbnail bypass CORS và Hotlink Referer")
async def proxy_downloader_image(url: str):
    import httpx
    if not url:
        raise HTTPException(status_code=400, detail="Missing url")
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
            "Referer": "https://www.douyin.com/",
            "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        }
        if "tiktok" in url:
            headers["Referer"] = "https://www.tiktok.com/"
        elif "xiaohongshu" in url:
            headers["Referer"] = "https://www.xiaohongshu.com/"

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                media_type = resp.headers.get("content-type", "image/jpeg")
                return Response(content=resp.content, media_type=media_type)
            raise HTTPException(status_code=resp.status_code, detail="Cannot fetch remote image")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/downloader/download", summary="Tải video trực tiếp về server để sử dụng trong Studio Mini")
async def download_video_to_studio(req: VideoDownloadRequest):
    from .services.video_downloader import download_video_file
    try:
        result = await download_video_file(
            video_url=req.video_url,
            title=req.title or "",
            platform=req.platform or ""
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải video về server: {str(e)}")

# ==========================================
# 6. PHỤC VỤ GIAO DIỆN FRONTEND (DESKTOP / WEB)
# ==========================================
FRONTEND_OUT = ROOT_DIR / "frontend" / "out"
if FRONTEND_OUT.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_OUT), html=True), name="frontend_app")

