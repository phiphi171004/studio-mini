export interface Voice {
  id: string;
  name: string;
  type: "preset" | "cloned";
  ref_audio_path?: string | null;
  description?: string | null;
  duration?: number | null;
  created_at: string;
}

export interface SegmentItem {
  id: number;
  start: number;
  end: number;
  text: string;
  translated_text?: string;
  actual_start?: number;
  actual_end?: number;
  audio_duration?: number;
  audio_file?: string;
}

export interface DubbingTask {
  id: string;
  video_filename: string;
  voice_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  current_step: string;
  progress: number;
  output_video_path?: string | null;
  original_srt_path?: string | null;
  translated_srt_path?: string | null;
  error_message?: string | null;
  segments_data?: SegmentItem[] | null;
  created_at: string;
  updated_at: string;
}
