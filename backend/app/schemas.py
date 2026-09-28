from typing import Optional, List, Any
from datetime import datetime
from enum import Enum
from pydantic import BaseModel

# Voice Schemas
class VoiceBase(BaseModel):
    name: str
    description: Optional[str] = None

class VoiceResponse(VoiceBase):
    id: str
    type: str
    ref_audio_path: Optional[str] = None
    duration: Optional[float] = None
    created_at: datetime

    class Config:
        from_attributes = True

# Task Schemas
class DubbingTaskResponse(BaseModel):
    id: str
    video_filename: str
    voice_id: str
    status: str
    current_step: str
    progress: int
    output_video_path: Optional[str] = None
    original_srt_path: Optional[str] = None
    translated_srt_path: Optional[str] = None
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    segments_data: Optional[List[Any]] = None
    remove_subtitles: Optional[bool] = True
    auto_inplace_overlay: Optional[bool] = False

    class Config:
        from_attributes = True

class SegmentItem(BaseModel):
    id: int
    start: float
    end: float
    original_text: str
    translated_text: Optional[str] = None
    actual_start: Optional[float] = None
    audio_duration: Optional[float] = None

# Subtitle Removal Schemas
class SubtitleRemovalMode(str, Enum):
    AUTO = "auto"
    MANUAL = "manual"

class ManualRegion(BaseModel):
    """Vùng phụ đề do user vẽ thủ công để xóa."""
    id: str
    name: str  # "Vùng 1", "Top Subtitle", etc.
    x: int
    y: int
    width: int
    height: int
    start_time: float  # seconds
    end_time: float    # seconds
