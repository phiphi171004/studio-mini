from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, JSON, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from .database import Base

class Voice(Base):
    __tablename__ = "voices"

    id = Column(String(64), primary_key=True, index=True)
    name = Column(String(128), nullable=False)
    type = Column(String(32), nullable=False, default="preset")  # "preset" hoặc "cloned"
    ref_audio_path = Column(String(512), nullable=True)          # File audio phát mẫu AI đã clone
    raw_audio_path = Column(String(512), nullable=True)          # File audio gốc người dùng tải lên dùng để nạp prompt clone
    description = Column(Text, nullable=True)
    duration = Column(Float, nullable=True)                      # Thời lượng file mẫu (giây)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Quan hệ với tasks
    tasks = relationship("DubbingTask", back_populates="voice")


class DubbingTask(Base):
    __tablename__ = "dubbing_tasks"

    id = Column(String(64), primary_key=True, index=True)
    video_filename = Column(String(256), nullable=False)
    input_video_path = Column(String(512), nullable=False)
    voice_id = Column(String(64), ForeignKey("voices.id"), nullable=False)
    
    # Trạng thái tiến trình
    status = Column(String(32), default="queued")       # "queued", "processing", "completed", "failed"
    current_step = Column(String(64), default="idle")    # "separating", "transcribing", "translating", "tts", "aligning", "mixing", "completed"
    progress = Column(Integer, default=0)                # 0 - 100 (%)
    remove_subtitles = Column(Boolean, default=True)     # Tự động xóa phụ đề gốc (True/False)
    auto_inplace_overlay = Column(Boolean, default=False) # Tự động phát hiện và đè thẻ phụ đề tại chỗ
    
    # Dữ liệu kịch bản / timestamps từng câu
    segments_data = Column(JSON, nullable=True)
    
    # Đầu ra & Lỗi
    output_video_path = Column(String(512), nullable=True)
    original_srt_path = Column(String(512), nullable=True)
    translated_srt_path = Column(String(512), nullable=True)
    error_message = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Quan hệ với voice
    voice = relationship("Voice", back_populates="tasks")
