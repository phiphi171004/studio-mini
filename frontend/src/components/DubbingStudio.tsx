"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Voice, DubbingTask, SegmentItem } from "@/types";
import { API_BASE } from "@/config";
import { CaptionModal } from "./CaptionModal";
import { VideoDownloaderModal } from "./VideoDownloaderModal";
import { ManualRemovalEditorModal, ManualRemovalRegion } from "./ManualRemovalEditorModal";
import { InplaceStyleModal, InplaceOverlayStyle, DEFAULT_INPLACE_STYLE } from "./InplaceStyleModal";
import { ModelDownloadModal, ModelInfo } from "./ModelDownloadModal";

interface DubbingStudioProps {
  voices: Voice[];
  onNavigateToVoices: () => void;
  initialVideoFile?: File | null;
  initialVideoUrl?: string | null;
}

function parseSrt(srtText: string): SegmentItem[] {
  const normalized = srtText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.trim().split(/\n\s*\n/);
  const result: SegmentItem[] = [];

  const toSeconds = (t: string) => {
    const parts = t.split(":");
    if (parts.length === 3) {
      const [h, m, rest] = parts;
      const [s, ms = "0"] = rest.split(/[,.]/);
      return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseInt(s, 10) + parseInt(ms, 10) / 1000;
    }
    return 0;
  };

  for (let i = 0; i < blocks.length; i++) {
    const lines = blocks[i].split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length >= 2) {
      const timeLine = lines[0].includes("-->") ? lines[0] : lines[1].includes("-->") ? lines[1] : "";
      if (timeLine) {
        const [startStr, endStr] = timeLine.split("-->").map((s) => s.trim());
        const textLines = lines.filter((l) => !l.includes("-->") && !/^\d+$/.test(l));
        const sSec = toSeconds(startStr);
        const eSec = toSeconds(endStr);
        result.push({
          id: i + 1,
          start: sSec,
          end: eSec,
          actual_start: sSec,
          actual_end: eSec,
          text: textLines.join(" "),
          translated_text: textLines.join(" "),
        });
      }
    }
  }
  return result;
}

function formatTimecode(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms}`;
}

function formatStepVietnamese(stepLabel: string): { icon: string; text: string } {
  if (!stepLabel) return { icon: "⚙️", text: "Đang khởi tạo studio lồng tiếng..." };

  if (stepLabel.startsWith("generating_tts")) {
    const match = stepLabel.match(/\(([^)]+)\)/);
    const progressCount = match ? ` (${match[1]})` : "";
    return {
      icon: "🗣️",
      text: `Bước 6/8: Đang sinh giọng đọc AI câu${progressCount} (VieNeu-TTS)`,
    };
  }

  if (stepLabel.startsWith("removing_subtitles")) {
    const detail = stepLabel.includes(":") ? stepLabel.split(":").slice(1).join(":").trim() : "";
    return {
      icon: "✂️",
      text: detail ? `Bước 2/8: ${detail}` : "Bước 2/8: Tự động quét & xóa sạch phụ đề cũ (AI)",
    };
  }

  if (stepLabel === "skipped_subtitles") {
    return {
      icon: "⏭️",
      text: "Bước 2/8: Bỏ qua xóa phụ đề cũ (Chế độ xóa chữ: TẮT)",
    };
  }

  const map: Record<string, { icon: string; text: string }> = {
    queued: { icon: "⏳", text: "Đang xếp hàng chờ xử lý" },
    extracting_audio: { icon: "🎵", text: "Bước 1/8: Trích xuất âm thanh gốc từ video" },
    transcribing: { icon: "📝", text: "Bước 3/8: Nhận diện giọng nói chuẩn 100% (CapCut ASR)" },
    translating: { icon: "🌐", text: "Bước 4/8: Dịch thuật ngữ cảnh & kịch bản Tiếng Việt" },
    separating_audio: { icon: "🎼", text: "Bước 5/8: Tách nhạc nền & xóa giọng cũ (Demucs AI)" },
    aligning_and_mixing: { icon: "🎚️", text: "Bước 7/8: Khớp Timeline câu thoại & Mix nhạc nền gốc" },
    merging_video: { icon: "🎬", text: "Bước 8/8: Ghép âm thanh lồng tiếng vào video thành phẩm" },
    completed: { icon: "✅", text: "Hoàn tất 100%! Video lồng tiếng mới đã sẵn sàng" },
    failed: { icon: "❌", text: "Quá trình lồng tiếng bị gián đoạn" },
  };

  const baseKey = stepLabel.split(" ")[0];
  return map[baseKey] || { icon: "⚙️", text: stepLabel };
}

export const DubbingStudio: React.FC<DubbingStudioProps> = ({
  voices,
  onNavigateToVoices,
  initialVideoFile,
  initialVideoUrl,
}) => {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(initialVideoFile || null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(initialVideoUrl || null);

  useEffect(() => {
    if (initialVideoFile) {
      setSelectedVideo(initialVideoFile);
    }
    if (initialVideoUrl) {
      setVideoPreviewUrl(initialVideoUrl);
    }
  }, [initialVideoFile, initialVideoUrl]);

  const [selectedVoiceId, setSelectedVoiceId] = useState<string>("");
  const [videoDragOver, setVideoDragOver] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [activeTask, setActiveTask] = useState<DubbingTask | null>(null);

  // Monitor & CapCut Player Controls
  const videoPlayerRef = useRef<HTMLVideoElement | null>(null);
  const [videoMode, setVideoMode] = useState<"source" | "result">("source");
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [showSubtitles, setShowSubtitles] = useState<boolean>(false); // Mặc định là OFF (TẮT)
  const [autoInplaceOverlay, setAutoInplaceOverlay] = useState<boolean>(false);
  const [removeSubtitles, setRemoveSubtitles] = useState<boolean>(true);
  const [subtitleRemovalMode, setSubtitleRemovalMode] = useState<"auto" | "manual">("auto");
  const [subtitleRemovalEngine, setSubtitleRemovalEngine] = useState<"frosted_glass" | "big_lama" | "directml_onnx">("frosted_glass");
  const [modelsStatus, setModelsStatus] = useState<Record<string, ModelInfo>>({});
  const [downloadModalKey, setDownloadModalKey] = useState<"big_lama" | "directml_onnx" | null>(null);

  const fetchModelsStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/models/status");
      if (res.ok) {
        const data = await res.json();
        setModelsStatus(data);
      }
    } catch (e) {
      console.warn("Fetch models status error:", e);
    }
  }, []);

  useEffect(() => {
    fetchModelsStatus();
  }, [fetchModelsStatus]);
  const [manualRegions, setManualRegions] = useState<ManualRemovalRegion[]>([]);
  const [isManualEditorOpen, setIsManualEditorOpen] = useState<boolean>(false);
  const [isEraserMode, setIsEraserMode] = useState<boolean>(false);
  const [subColorTheme, setSubColorTheme] = useState<"yellow" | "white" | "cyan">("yellow");
  const [showDownloaderModal, setShowDownloaderModal] = useState<boolean>(false);
  const [isInplaceStyleModalOpen, setIsInplaceStyleModalOpen] = useState<boolean>(false);
  const [inplaceStyle, setInplaceStyle] = useState<InplaceOverlayStyle>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("studio_mini_inplace_style");
        if (saved) return JSON.parse(saved);
      } catch (e) {}
    }
    return DEFAULT_INPLACE_STYLE;
  });

  const handleUpdateInplaceStyle = (newStyle: InplaceOverlayStyle) => {
    setInplaceStyle(newStyle);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("studio_mini_inplace_style", JSON.stringify(newStyle));
      } catch (e) {}
    }
  };

  // Khung Tùy Chỉnh Phụ Đề Mới (Interactive & Resizable Subtitle Box)
  // Tọa độ (%) tính trực tiếp theo VIDEO THỰC TẾ (loại trừ dải đen)
  const [subBox, setSubBox] = useState<{ x: number; y: number; w: number; h: number }>({
    x: 8,
    y: 76,
    w: 84,
    h: 15,
  });
  const canvasRef = useRef<HTMLDivElement>(null);
  const [videoBounds, setVideoBounds] = useState<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  // Tính toán vùng video thực tế đang hiển thị trên canvas (loại trừ letterbox/pillarbox)
  const updateVideoBounds = useCallback(() => {
    const vid = videoPlayerRef.current;
    const canvas = canvasRef.current;
    if (!vid || !canvas) return;

    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const vw = vid.videoWidth || 1280;
    const vh = vid.videoHeight || 720;
    if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return;

    const canvasAspect = cw / ch;
    const videoAspect = vw / vh;

    let renderW = cw;
    let renderH = ch;
    let left = 0;
    let top = 0;

    if (videoAspect < canvasAspect) {
      // Video dạng đứng/dọc (ví dụ 9:16 trên màn 16:9) -> dải đen 2 bên
      renderH = ch;
      renderW = ch * videoAspect;
      left = (cw - renderW) / 2;
      top = 0;
    } else {
      // Video dạng ngang rộng hơn màn hình -> dải đen trên dưới
      renderW = cw;
      renderH = cw / videoAspect;
      left = 0;
      top = (ch - renderH) / 2;
    }

    setVideoBounds({
      left: Math.round(left),
      top: Math.round(top),
      width: Math.round(renderW),
      height: Math.round(renderH),
    });
  }, []);

  // Lắng nghe thay đổi kích thước canvas & window để video bounds luôn khớp 100%
  useEffect(() => {
    updateVideoBounds();
  }, [updateVideoBounds]);

  useEffect(() => {
    const handleResize = () => updateVideoBounds();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateVideoBounds]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ro = new ResizeObserver(() => updateVideoBounds());
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [updateVideoBounds]);

  // Logic Kéo Di Chuyển & Co Giãn 8 Hướng (Drag & Resize Handles)
  type SubDragAction = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";
  const activeSubDragActionRef = useRef<SubDragAction | null>(null);
  const subDragStartRef = useRef<{
    clientX: number;
    clientY: number;
    boxX: number;
    boxY: number;
    boxW: number;
    boxH: number;
    viewportW: number;
    viewportH: number;
  }>({
    clientX: 0,
    clientY: 0,
    boxX: 8,
    boxY: 76,
    boxW: 84,
    boxH: 15,
    viewportW: 100,
    viewportH: 100,
  });

  const handleSubDragStart = (e: React.MouseEvent, action: SubDragAction) => {
    e.preventDefault();
    e.stopPropagation();
    activeSubDragActionRef.current = action;

    const vpW = videoBounds.width > 10 ? videoBounds.width : (canvasRef.current?.clientWidth || 1);
    const vpH = videoBounds.height > 10 ? videoBounds.height : (canvasRef.current?.clientHeight || 1);

    subDragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      boxX: subBox.x,
      boxY: subBox.y,
      boxW: subBox.w,
      boxH: subBox.h,
      viewportW: vpW,
      viewportH: vpH,
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!activeSubDragActionRef.current) return;
      const { clientX, clientY, boxX, boxY, boxW, boxH, viewportW, viewportH } = subDragStartRef.current;
      const deltaXPercent = ((moveEvent.clientX - clientX) / viewportW) * 100;
      const deltaYPercent = ((moveEvent.clientY - clientY) / viewportH) * 100;

      let newX = boxX;
      let newY = boxY;
      let newW = boxW;
      let newH = boxH;

      const act = activeSubDragActionRef.current;

      if (act === "move") {
        newX = Math.max(0, Math.min(100 - boxW, boxX + deltaXPercent));
        newY = Math.max(0, Math.min(100 - boxH, boxY + deltaYPercent));
      } else {
        // Co giãn theo hướng E (phải)
        if (act.includes("e")) {
          newW = Math.max(20, Math.min(100 - boxX, boxW + deltaXPercent));
        }
        // Co giãn theo hướng W (trái)
        if (act.includes("w")) {
          const maxLeftShift = boxW - 20;
          const shift = Math.min(maxLeftShift, Math.max(-boxX, deltaXPercent));
          newX = boxX + shift;
          newW = boxW - shift;
        }
        // Co giãn theo hướng S (dưới)
        if (act.includes("s")) {
          newH = Math.max(6, Math.min(100 - boxY, boxH + deltaYPercent));
        }
        // Co giãn theo hướng N (trên)
        if (act.includes("n")) {
          const maxTopShift = boxH - 6;
          const shift = Math.min(maxTopShift, Math.max(-boxY, deltaYPercent));
          newY = boxY + shift;
          newH = boxH - shift;
        }
      }

      setSubBox({
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        w: Math.round(newW * 10) / 10,
        h: Math.round(newH * 10) / 10,
      });
    };

    const handleMouseUp = () => {
      activeSubDragActionRef.current = null;
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleSubTouchDragStart = (e: React.TouchEvent, action: SubDragAction) => {
    if (e.touches.length !== 1) return;
    e.stopPropagation();
    const touch = e.touches[0];
    activeSubDragActionRef.current = action;

    const vpW = videoBounds.width > 10 ? videoBounds.width : (canvasRef.current?.clientWidth || 1);
    const vpH = videoBounds.height > 10 ? videoBounds.height : (canvasRef.current?.clientHeight || 1);

    subDragStartRef.current = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      boxX: subBox.x,
      boxY: subBox.y,
      boxW: subBox.w,
      boxH: subBox.h,
      viewportW: vpW,
      viewportH: vpH,
    };

    const handleTouchMove = (moveEvent: TouchEvent) => {
      if (!activeSubDragActionRef.current || moveEvent.touches.length !== 1) return;
      const t = moveEvent.touches[0];
      const { clientX, clientY, boxX, boxY, boxW, boxH, viewportW, viewportH } = subDragStartRef.current;
      const deltaXPercent = ((t.clientX - clientX) / viewportW) * 100;
      const deltaYPercent = ((t.clientY - clientY) / viewportH) * 100;

      let newX = boxX;
      let newY = boxY;
      let newW = boxW;
      let newH = boxH;

      const act = activeSubDragActionRef.current;

      if (act === "move") {
        newX = Math.max(0, Math.min(100 - boxW, boxX + deltaXPercent));
        newY = Math.max(0, Math.min(100 - boxH, boxY + deltaYPercent));
      } else {
        if (act.includes("e")) {
          newW = Math.max(20, Math.min(100 - boxX, boxW + deltaXPercent));
        }
        if (act.includes("w")) {
          const maxLeftShift = boxW - 20;
          const shift = Math.min(maxLeftShift, Math.max(-boxX, deltaXPercent));
          newX = boxX + shift;
          newW = boxW - shift;
        }
        if (act.includes("s")) {
          newH = Math.max(6, Math.min(100 - boxY, boxH + deltaYPercent));
        }
        if (act.includes("n")) {
          const maxTopShift = boxH - 6;
          const shift = Math.min(maxTopShift, Math.max(-boxY, deltaYPercent));
          newY = boxY + shift;
          newH = boxH - shift;
        }
      }

      setSubBox({
        x: Math.round(newX * 10) / 10,
        y: Math.round(newY * 10) / 10,
        w: Math.round(newW * 10) / 10,
        h: Math.round(newH * 10) / 10,
      });
    };

    const handleTouchEnd = () => {
      activeSubDragActionRef.current = null;
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
    };

    window.addEventListener("touchmove", handleTouchMove);
    window.addEventListener("touchend", handleTouchEnd);
  };

  // Lower Panel (Timeline & Log)
  const [activeLowerTab, setActiveLowerTab] = useState<"subtitles" | "terminal">("subtitles");
  const [segments, setSegments] = useState<SegmentItem[]>([]);
  const [subSearchQuery, setSubSearchQuery] = useState<string>("");

  // AI Translation & Groq STT Settings State
  const [aiApiKey, setAiApiKey] = useState<string>("");
  const [aiBaseUrl, setAiBaseUrl] = useState<string>("https://generativelanguage.googleapis.com");
  const [aiModel, setAiModel] = useState<string>("gemini-3.5-flash-lite");
  const [groqApiKey, setGroqApiKey] = useState<string>("");
  const [hasGroqKey, setHasGroqKey] = useState<boolean>(false);
  const [hasServerKey, setHasServerKey] = useState<boolean>(false);

  const [customSrtFile, setCustomSrtFile] = useState<File | null>(null);
  const [showCaptionModal, setShowCaptionModal] = useState<boolean>(false);
  const [captionModalTab, setCaptionModalTab] = useState<"caption" | "comment">("caption");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const srtFileInputRef = useRef<HTMLInputElement | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll terminal log internally
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logLines]);

  // Sync segments from activeTask when completed or updated
  useEffect(() => {
    if (activeTask?.segments_data && activeTask.segments_data.length > 0) {
      setSegments(activeTask.segments_data);
    }
  }, [activeTask?.segments_data]);

  // Handle custom SRT parsing
  useEffect(() => {
    if (customSrtFile) {
      customSrtFile.text().then((txt) => {
        const parsed = parseSrt(txt);
        if (parsed.length > 0) {
          setSegments(parsed);
          setActiveLowerTab("subtitles");
        }
      }).catch(() => {});
    }
  }, [customSrtFile]);

  // Auto-select first preset voice if available
  useEffect(() => {
    if (voices.length > 0 && !selectedVoiceId) {
      setSelectedVoiceId(voices[0].id);
    }
  }, [voices, selectedVoiceId]);

  // Create preview URL for selected video
  useEffect(() => {
    if (selectedVideo) {
      const url = URL.createObjectURL(selectedVideo);
      setVideoPreviewUrl(url);
      setVideoMode("source");
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setVideoPreviewUrl(null);
    }
  }, [selectedVideo]);

  // Switch video mode to result automatically when task completes
  useEffect(() => {
    if (activeTask?.status === "completed") {
      setVideoMode("result");
    }
  }, [activeTask?.status]);

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  // Fetch AI settings from Backend & LocalStorage on mount
  useEffect(() => {
    const cachedKey = typeof window !== "undefined" ? localStorage.getItem("studio_mini_ai_key") : null;
    if (cachedKey) setAiApiKey(cachedKey);

    const cachedGroq = typeof window !== "undefined" ? localStorage.getItem("studio_mini_groq_key") : null;
    if (cachedGroq) setGroqApiKey(cachedGroq);

    fetch(`${API_BASE}/api/settings/ai`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (data.base_url) setAiBaseUrl(data.base_url);
          if (data.model) setAiModel(data.model);
          if (data.has_key) {
            setHasServerKey(true);
            if (!cachedKey && data.masked_key) {
              setAiApiKey(data.masked_key);
            }
          }
          if (data.has_groq_key) {
            setHasGroqKey(true);
            if (!cachedGroq && data.masked_groq_key) {
              setGroqApiKey(data.masked_groq_key);
            }
          }
        }
      })
      .catch(() => {});
  }, []);

  // Auto-resume task if backend has active task
  useEffect(() => {
    fetch(`${API_BASE}/api/dubbing/latest`)
      .then((res) => (res.ok ? res.json() : null))
      .then((task: DubbingTask | null) => {
        if (task && (task.status === "processing" || task.status === "queued")) {
          setActiveTask(task);
          setIsStarting(true);
          startPolling(task.id);
        }
      })
      .catch(() => {});
  }, []);

  const handleTogglePreview = (path: string) => {
    if (isPlayingPreview) {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setIsPlayingPreview(false);
      return;
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    const cleanPath = path.replace(/\\/g, "/");
    const audioUrl = cleanPath.startsWith("/") ? `${API_BASE}${cleanPath}` : `${API_BASE}/${cleanPath}`;
    const audio = new Audio(audioUrl);
    previewAudioRef.current = audio;
    setIsPlayingPreview(true);
    audio.play().catch((e) => {
      console.log("Lỗi phát audio:", e);
      setIsPlayingPreview(false);
      previewAudioRef.current = null;
    });
    audio.onended = () => {
      setIsPlayingPreview(false);
      previewAudioRef.current = null;
    };
    audio.onerror = () => {
      console.log("Lỗi tải audio:", audioUrl);
      setIsPlayingPreview(false);
      previewAudioRef.current = null;
    };
  };

  const handleVideoDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setVideoDragOver(false);
    if (e.dataTransfer.files.length) {
      setSelectedVideo(e.dataTransfer.files[0]);
    }
  };

  const handleStartDubbing = async (e?: React.SyntheticEvent) => {
    if (e) e.preventDefault();
    if (!selectedVideo) {
      alert("Vui lòng chọn video cần lồng tiếng.");
      return;
    }
    if (!selectedVoiceId) {
      alert("Vui lòng chọn giọng đọc.");
      return;
    }

    if (removeSubtitles) {
      if (subtitleRemovalEngine === "big_lama" && !modelsStatus.big_lama?.downloaded) {
        setDownloadModalKey("big_lama");
        return;
      }
      if (subtitleRemovalEngine === "directml_onnx" && !modelsStatus.directml_onnx?.downloaded) {
        setDownloadModalKey("directml_onnx");
        return;
      }
    }

    setIsStarting(true);
    setActiveLowerTab("terminal");
    const formData = new FormData();
    formData.append("video_file", selectedVideo);
    formData.append("voice_id", selectedVoiceId);
    formData.append("remove_subtitles", removeSubtitles ? "true" : "false");
    formData.append("subtitle_removal_mode", subtitleRemovalMode);
    formData.append("subtitle_removal_engine", subtitleRemovalEngine);
    if (removeSubtitles && subtitleRemovalMode === "manual" && manualRegions.length > 0) {
      // Map về format backend: x, y, w, h dạng tỷ lệ 0..1, start_time, end_time dạng giây
      const formattedRegions = manualRegions.map((r) => ({
        id: r.id,
        name: r.name,
        x: r.x,
        y: r.y,
        w: r.w,
        h: r.h,
        start_time: r.startTime,
        end_time: r.endTime,
      }));
      formData.append("manual_regions", JSON.stringify(formattedRegions));
    }
    formData.append("burn_subtitles", showSubtitles ? "true" : "false");
    formData.append("auto_inplace_overlay", autoInplaceOverlay ? "true" : "false");
    if (autoInplaceOverlay) {
      formData.append("inplace_style", JSON.stringify(inplaceStyle));
    }
    formData.append("subtitle_y", (subBox.y / 100).toFixed(4));
    formData.append("subtitle_h", (subBox.h / 100).toFixed(4));
    formData.append("subtitle_color", subColorTheme);

    if (customSrtFile) {
      formData.append("custom_srt_file", customSrtFile);
    }
    if (aiApiKey && !aiApiKey.includes("...")) {
      formData.append("ai_api_key", aiApiKey);
    }
    if (aiBaseUrl) formData.append("ai_base_url", aiBaseUrl);
    if (aiModel) formData.append("ai_model", aiModel);
    if (groqApiKey && !groqApiKey.includes("...")) {
      formData.append("groq_api_key", groqApiKey);
    }

    try {
      const res = await fetch(`${API_BASE}/api/dubbing/start`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể bắt đầu lồng tiếng.");
      }

      const task: DubbingTask = await res.json();
      setActiveTask(task);
      startPolling(task.id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Đã xảy ra lỗi";
      alert("Lỗi: " + message);
      setIsStarting(false);
    }
  };

  const startPolling = (taskId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setLogLines([`[${new Date().toLocaleTimeString()}] 🚀 Bắt đầu luồng lồng tiếng tự động 8 bước...`]);

    pollingRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/dubbing/${taskId}`);
        if (!res.ok) return;
        const task: DubbingTask = await res.json();
        setActiveTask(task);

        const time = new Date().toLocaleTimeString();
        const stepLabel = task.current_step || "";
        if (stepLabel) {
          if (stepLabel.startsWith("removing_subtitles")) {
            const detail = stepLabel.includes(":") ? stepLabel.split(":").slice(1).join(":").trim() : "";
            setLogLines((prev) => {
              const hasMainStep = prev.some((l) => l.includes("Bước 2/8: Bắt đầu quét & xóa phụ đề cũ"));
              const newLines = [...prev];
              if (!hasMainStep) {
                newLines.push(`[${time}] ✂️ Bước 2/8: Bắt đầu quét & xóa phụ đề cũ toàn video (AI Inpainting)...`);
              }
              if (detail) {
                const subLine = `[${time}]    ↳ ${detail}`;
                const lastLine = newLines[newLines.length - 1] || "";
                if (lastLine !== subLine && !lastLine.includes(detail)) {
                  newLines.push(subLine);
                }
              }
              return newLines;
            });
          } else {
            const { icon, text: viStepText } = formatStepVietnamese(stepLabel);
            setLogLines((prev) => {
              const lastLine = prev[prev.length - 1] || "";
              const newLine = `[${time}] ${icon} ${viStepText} — ${task.progress}%`;
              if (lastLine.includes(viStepText) && lastLine.includes(`${task.progress}%`)) return prev;
              return [...prev, newLine];
            });
          }
        }

        if (task.status === "completed" || task.status === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setIsStarting(false);
          const time2 = new Date().toLocaleTimeString();
          if (task.status === "completed") {
            setLogLines((prev) => [...prev, `[${time2}] ✅ Hoàn tất 100%! Video lồng tiếng mới đã sẵn sàng để tải về hoặc xem ngay.`]);
            setVideoMode("result");
          } else {
            setLogLines((prev) => [...prev, `[${time2}] ❌ Lỗi xử lý: ${task.error_message || "Đã xảy ra lỗi không xác định"}`]);
          }
        }
      } catch (e) {
        console.error("Lỗi polling:", e);
      }
    }, 700);
  };

  const handleResetTask = async () => {
    if (activeTask && (activeTask.status === "processing" || activeTask.status === "queued")) {
      try {
        await fetch(`${API_BASE}/api/dubbing/${activeTask.id}/cancel`, { method: "POST" });
      } catch {}
    }
    if (pollingRef.current) clearInterval(pollingRef.current);
    setActiveTask(null);
    setIsStarting(false);
    setSelectedVideo(null);
    setCustomSrtFile(null);
    setSegments([]);
  };

  const handleAddSubtitle = () => {
    const newId = segments.length > 0 ? Math.max(...segments.map((s) => s.id)) + 1 : 1;
    const sTime = Math.max(0, currentTime);
    const eTime = sTime + 3;
    const newSeg: SegmentItem = {
      id: newId,
      start: sTime,
      end: eTime,
      actual_start: sTime,
      actual_end: eTime,
      text: "Nhập phụ đề mới...",
      translated_text: "Nhập phụ đề dịch...",
    };
    setSegments((prev) => [...prev, newSeg].sort((a, b) => (a.actual_start || 0) - (b.actual_start || 0)));
    setActiveLowerTab("subtitles");
  };

  const handleDeleteSubtitle = (id: number) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };

  const handleUpdateSubtitleText = (id: number, newText: string) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, translated_text: newText } : s))
    );
  };

  const handleSeekVideo = (targetSeconds: number) => {
    if (videoPlayerRef.current) {
      videoPlayerRef.current.currentTime = targetSeconds;
      videoPlayerRef.current.play().catch(() => {});
    }
  };

  // Find active subtitle corresponding to current playback time
  const currentActiveSub = segments.find((s) => {
    const sTime = s.actual_start ?? s.start;
    const eTime = s.actual_end ?? s.end;
    return currentTime >= sTime && currentTime <= eTime;
  });

  const selectedVoice = voices.find((v) => v.id === selectedVoiceId);
  const isCompleted = activeTask?.status === "completed";
  const isProcessing = activeTask?.status === "processing" || isStarting;

  const cleanVideoPath = activeTask?.output_video_path
    ? activeTask.output_video_path.replace(/\\/g, "/")
    : "";
  const resultVideoUrl = cleanVideoPath.startsWith("/")
    ? `${API_BASE}${cleanVideoPath}`
    : `${API_BASE}/${cleanVideoPath}`;

  // Current active video source for canvas
  const currentVideoSource = videoMode === "result" && isCompleted ? resultVideoUrl : videoPreviewUrl;

  const filteredSegments = segments.filter((s) => {
    if (!subSearchQuery) return true;
    const q = subSearchQuery.toLowerCase();
    return (
      (s.text && s.text.toLowerCase().includes(q)) ||
      (s.translated_text && s.translated_text.toLowerCase().includes(q))
    );
  });

  return (
    <div className="capcut-studio-container">
      {/* Hidden file inputs for video & srt picking */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/x-matroska"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            setSelectedVideo(e.target.files[0]);
          }
        }}
      />
      <input
        ref={srtFileInputRef}
        type="file"
        accept=".srt"
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files?.length) {
            setCustomSrtFile(e.target.files[0]);
          }
        }}
      />

      {/* ── Main Stage: CapCut Video Monitor & Lower Timeline Panel ── */}
      <main className="capcut-main-stage">
        {/* Top: CapCut Video Monitor Card */}
        <div className="capcut-monitor">
          {/* Monitor Header */}
          <div className="capcut-monitor-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div className="capcut-monitor-title">
                <span>🎬</span> Trình Chiếu & Biên Tập Video
              </div>

              {/* Nút Start Bắt Đầu Lồng Tiếng AI hiện kế bên tiêu đề */}
              <button
                type="button"
                onClick={() => handleStartDubbing()}
                className="btn btn-primary btn-glow"
                disabled={isProcessing}
                style={{
                  padding: "6px 16px",
                  fontSize: "0.85rem",
                  borderRadius: "8px",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  fontWeight: 700,
                  boxShadow: "0 0 14px rgba(99, 102, 241, 0.4)",
                }}
              >
                {isProcessing ? (
                  <>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 1s linear infinite" }} />
                    <span>Đang xử lý lồng tiếng...</span>
                  </>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    <span>Bắt Đầu Lồng Tiếng AI</span>
                  </>
                )}
              </button>

              {/* Nút Đổi Video Khác (chỉ xuất hiện khi đã có video để đổi nhanh) */}
              {selectedVideo && (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-secondary btn-sm"
                  style={{
                    padding: "5px 12px",
                    fontSize: "0.8rem",
                    borderRadius: "8px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "rgba(255, 255, 255, 0.08)",
                  }}
                  title={`Đang xem: ${selectedVideo.name}. Bấm để đổi sang video khác`}
                >
                  <span>🔄 Đổi Video</span>
                </button>
              )}
            </div>

            {/* Switch between Original & Dubbed Video */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div className="capcut-mode-tabs">
                <button
                  type="button"
                  className={`capcut-mode-btn ${videoMode === "source" ? "active" : ""}`}
                  onClick={() => setVideoMode("source")}
                  disabled={!videoPreviewUrl}
                >
                  🎬 Video Gốc
                </button>
                <button
                  type="button"
                  className={`capcut-mode-btn ${videoMode === "result" ? "active result" : ""}`}
                  onClick={() => setVideoMode("result")}
                  disabled={!isCompleted}
                  title={!isCompleted ? "Video thành phẩm sẽ có sau khi chạy xong pipeline" : "Xem video đã lồng tiếng mới"}
                >
                  ✨ Video Đã Lồng Tiếng
                </button>
              </div>

              {/* Timecode */}
              <div style={{ fontFamily: "monospace", fontSize: "0.82rem", color: "#94a3b8", background: "rgba(15, 23, 42, 0.8)", padding: "4px 10px", borderRadius: "6px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
                {formatTimecode(currentTime)} / {formatTimecode(duration)}
              </div>
            </div>
          </div>

          {/* Main Video Canvas */}
          <div
            ref={canvasRef}
            className="capcut-canvas"
            onDragOver={(e) => {
              e.preventDefault();
              setVideoDragOver(true);
            }}
            onDragLeave={() => setVideoDragOver(false)}
            onDrop={handleVideoDrop}
          >
            {!currentVideoSource ? (
              <div
                className="capcut-canvas-empty"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setVideoDragOver(true);
                }}
                onDragLeave={() => setVideoDragOver(false)}
                onDrop={handleVideoDrop}
                style={{ cursor: "pointer" }}
              >
                <div className="capcut-canvas-empty-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                </div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
                  Trình Chiếu Video Studio (CapCut Monitor)
                </h3>
                <p style={{ fontSize: "0.82rem", color: "#94a3b8", maxWidth: "420px", margin: 0 }}>
                  Tải lên video hoặc kéo thả vào đây để bắt đầu xem trước, xóa phụ đề cũ và tạo lồng tiếng AI mới.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: "10px" }}
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                >
                  📁 Duyệt file video ngay
                </button>
              </div>
            ) : (
              <>
                <video
                  ref={videoPlayerRef}
                  src={currentVideoSource}
                  controls
                  playsInline
                  preload="metadata"
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    setDuration(e.currentTarget.duration);
                    updateVideoBounds();
                  }}
                />

                {/* Khung Tùy Chỉnh Vị Trí Phụ Đề Mới (Chỉ hiện khi ở tab Video Gốc để căn chỉnh, ẩn hoàn toàn khi xem video thành phẩm) */}
                {showSubtitles && videoMode === "source" && (
                  <>
                    {/* Quick Adjuster Bar trên góc canvas */}
                    <div className="capcut-sub-adjuster">
                      <span style={{ fontWeight: 600 }}>↕️ Cao Y:</span>
                      <input
                        type="range"
                        min="5"
                        max="90"
                        value={Math.round(subBox.y)}
                        onChange={(e) => setSubBox((prev) => ({ ...prev, y: Number(e.target.value) }))}
                        style={{ width: "65px", cursor: "pointer", accentColor: "#6366f1" }}
                      />
                      <span>{Math.round(subBox.y)}%</span>

                      <span style={{ fontWeight: 600, marginLeft: "4px" }}>↔️ Rộng:</span>
                      <input
                        type="range"
                        min="20"
                        max="96"
                        value={Math.round(subBox.w)}
                        onChange={(e) => setSubBox((prev) => ({ ...prev, w: Number(e.target.value) }))}
                        style={{ width: "65px", cursor: "pointer", accentColor: "#6366f1" }}
                      />
                      <span>{Math.round(subBox.w)}%</span>

                      <button
                        type="button"
                        onClick={() => setSubBox((prev) => ({ ...prev, x: Math.round((100 - prev.w) / 2) }))}
                        title="Căn giữa khung vào giữa màn hình video"
                        style={{
                          background: "rgba(99, 102, 241, 0.25)",
                          border: "1px solid rgba(99, 102, 241, 0.4)",
                          borderRadius: "4px",
                          color: "#c7d2fe",
                          padding: "2px 7px",
                          fontSize: "0.72rem",
                          cursor: "pointer",
                        }}
                      >
                        ☵ Căn giữa
                      </button>

                      <button
                        type="button"
                        onClick={() => setSubBox({ x: 8, y: 76, w: 84, h: 15 })}
                        title="Đặt lại vị trí mặc định dưới đáy"
                        style={{
                          background: "rgba(255, 255, 255, 0.1)",
                          border: "none",
                          borderRadius: "4px",
                          color: "#e2e8f0",
                          padding: "2px 7px",
                          fontSize: "0.72rem",
                          cursor: "pointer",
                        }}
                      >
                        ↺ Mặc định
                      </button>
                    </div>

                    {/* Vùng Viewport ôm sát video thực tế (loại bỏ dải đen 2 bên và trên dưới) */}
                    <div
                      style={{
                        position: "absolute",
                        left: videoBounds.width > 0 ? `${videoBounds.left}px` : "0px",
                        top: videoBounds.height > 0 ? `${videoBounds.top}px` : "0px",
                        width: videoBounds.width > 0 ? `${videoBounds.width}px` : "100%",
                        height: videoBounds.height > 0 ? `${videoBounds.height}px` : "100%",
                        pointerEvents: "none",
                        zIndex: 15,
                        overflow: "visible",
                      }}
                    >
                      {/* Khung tương tác kéo thả & co giãn */}
                      <div
                        className="capcut-sub-box"
                        style={{
                          position: "absolute",
                          top: `${subBox.y}%`,
                          left: `${subBox.x}%`,
                          width: `${subBox.w}%`,
                          height: `${subBox.h}%`,
                          pointerEvents: "auto",
                        }}
                        onMouseDown={(e) => handleSubDragStart(e, "move")}
                        onTouchStart={(e) => handleSubTouchDragStart(e, "move")}
                        title="Giữ chuột kéo để di chuyển, hoặc nắm các chốt để co giãn khung"
                      >
                        <div className="capcut-sub-box-header">
                          <span>⠿ Khung Phụ Đề (Kéo & Co giãn)</span>
                        </div>

                        {/* 4 Chốt co giãn ở góc */}
                        <div className="sub-handle sub-handle-nw" onMouseDown={(e) => handleSubDragStart(e, "nw")} onTouchStart={(e) => handleSubTouchDragStart(e, "nw")} title="Co giãn góc trên-trái" />
                        <div className="sub-handle sub-handle-ne" onMouseDown={(e) => handleSubDragStart(e, "ne")} onTouchStart={(e) => handleSubTouchDragStart(e, "ne")} title="Co giãn góc trên-phải" />
                        <div className="sub-handle sub-handle-sw" onMouseDown={(e) => handleSubDragStart(e, "sw")} onTouchStart={(e) => handleSubTouchDragStart(e, "sw")} title="Co giãn góc dưới-trái" />
                        <div className="sub-handle sub-handle-se" onMouseDown={(e) => handleSubDragStart(e, "se")} onTouchStart={(e) => handleSubTouchDragStart(e, "se")} title="Co giãn góc dưới-phải" />

                        {/* 4 Chốt co giãn ở cạnh */}
                        <div className="sub-handle sub-handle-n" onMouseDown={(e) => handleSubDragStart(e, "n")} onTouchStart={(e) => handleSubTouchDragStart(e, "n")} title="Co giãn cạnh trên" />
                        <div className="sub-handle sub-handle-s" onMouseDown={(e) => handleSubDragStart(e, "s")} onTouchStart={(e) => handleSubTouchDragStart(e, "s")} title="Co giãn cạnh dưới" />
                        <div className="sub-handle sub-handle-w" onMouseDown={(e) => handleSubDragStart(e, "w")} onTouchStart={(e) => handleSubTouchDragStart(e, "w")} title="Co giãn cạnh trái" />
                        <div className="sub-handle sub-handle-e" onMouseDown={(e) => handleSubDragStart(e, "e")} onTouchStart={(e) => handleSubTouchDragStart(e, "e")} title="Co giãn cạnh phải" />

                        <div
                          className="capcut-sub-content"
                          style={{
                            color: subColorTheme === "yellow" ? "#fef08a" : subColorTheme === "cyan" ? "#67e8f9" : "#ffffff",
                          }}
                        >
                          {currentActiveSub ? (
                            <span>{currentActiveSub.translated_text || currentActiveSub.text}</span>
                          ) : (
                            <span style={{ opacity: 0.6, fontStyle: "italic", fontSize: "0.85rem" }}>
                              [Xem trước chữ phụ đề mới tại đây]
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* Subtitle Eraser Zone (Inpaint / Watermark OCR removal guide) */}
                {isEraserMode && videoMode === "source" && (
                  <div className="capcut-eraser-box">
                    <span className="capcut-eraser-tag">
                      ✂️ Vùng Nhận Diện & Xóa Phụ Đề Gốc (OCR / Inpaint Mode)
                    </span>
                  </div>
                )}

                {/* Processing Overlay during Dubbing */}
                {isProcessing && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: "rgba(9, 13, 22, 0.85)",
                      backdropFilter: "blur(6px)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "12px",
                      zIndex: 20,
                    }}
                  >
                    <div
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        border: "3px solid rgba(99, 102, 241, 0.25)",
                        borderTopColor: "#6366f1",
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#a5b4fc", textAlign: "center" }}>
                      ⚡ {formatStepVietnamese(activeTask?.current_step || "").text}
                    </div>
                    <div style={{ background: "#6366f1", borderRadius: "20px", padding: "4px 16px", fontSize: "0.85rem", fontWeight: 700, color: "#fff" }}>
                      {activeTask?.progress || 0}%
                    </div>
                    <div style={{ width: "50%", height: 5, background: "rgba(255, 255, 255, 0.15)", borderRadius: 4, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${activeTask?.progress || 0}%`,
                          background: "linear-gradient(90deg, #6366f1, #06b6d4)",
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleResetTask}
                      style={{
                        background: "rgba(239, 68, 68, 0.25)",
                        border: "1px solid rgba(239, 68, 68, 0.5)",
                        color: "#fca5a5",
                        borderRadius: "8px",
                        padding: "5px 14px",
                        fontSize: "0.78rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      ✕ Hủy tác vụ
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* CapCut Subtitle & Editing Action Toolbar */}
          <div className="capcut-toolbar">
            <div className="capcut-tool-group">
              {/* Voice Selection Selector in Toolbar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: "rgba(15, 23, 42, 0.7)",
                  padding: "3px 8px",
                  borderRadius: "8px",
                  border: "1px solid rgba(99, 102, 241, 0.35)",
                }}
              >
                <label
                  htmlFor="voice-select-toolbar"
                  style={{
                    fontSize: "0.8rem",
                    fontWeight: 700,
                    color: "#a5b4fc",
                    whiteSpace: "nowrap",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    cursor: "pointer",
                    margin: 0,
                  }}
                >
                  🎙️ Giọng:
                </label>
                <select
                  id="voice-select-toolbar"
                  className="custom-select"
                  value={selectedVoiceId}
                  onChange={(e) => setSelectedVoiceId(e.target.value)}
                  style={{
                    padding: "3px 8px",
                    fontSize: "0.78rem",
                    height: "30px",
                    minWidth: "150px",
                    maxWidth: "210px",
                    borderRadius: "6px",
                    background: "#0f172a",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    color: "#f8fafc",
                  }}
                >
                  <optgroup label="🌟 Giọng Mẫu (VieNeu-TTS)">
                    {voices
                      .filter((v) => v.type === "preset")
                      .map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.description || "Tiếng Việt"})
                        </option>
                      ))}
                  </optgroup>
                  {voices.filter((v) => v.type === "cloned").length > 0 && (
                    <optgroup label="🎙️ Giọng Đã Clone (Custom Voices)">
                      {voices
                        .filter((v) => v.type === "cloned")
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} - {v.description || "Giọng cá nhân"}
                          </option>
                        ))}
                    </optgroup>
                  )}
                </select>

                {selectedVoice?.ref_audio_path && (
                  <button
                    type="button"
                    className="btn-listen"
                    style={{ padding: "3px 8px", fontSize: "0.72rem", height: "26px", borderRadius: "5px" }}
                    onClick={() => handleTogglePreview(selectedVoice.ref_audio_path!)}
                    title="Nghe thử giọng mẫu"
                  >
                    {isPlayingPreview ? "⏹ Dừng" : "▶ Nghe"}
                  </button>
                )}

                <button
                  type="button"
                  onClick={onNavigateToVoices}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#818cf8",
                    fontSize: "0.74rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                    whiteSpace: "nowrap",
                    padding: "0 2px",
                  }}
                  title="Mở thư viện kho giọng đọc AI"
                >
                  + Kho Giọng
                </button>
              </div>

              {/* Change Video & Import SRT buttons */}
              {selectedVideo && (
                <button
                  type="button"
                  className="capcut-tool-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Chọn video khác từ máy tính"
                >
                  🎬 Đổi Video
                </button>
              )}

              <button
                type="button"
                className={`capcut-tool-btn ${customSrtFile ? "active" : ""}`}
                onClick={() => srtFileInputRef.current?.click()}
                title={customSrtFile ? `File SRT: ${customSrtFile.name} (Click để đổi)` : "Nhập file phụ đề .SRT (Tùy chọn)"}
              >
                📄 {customSrtFile ? `SRT: ${customSrtFile.name.length > 15 ? customSrtFile.name.slice(0, 15) + "..." : customSrtFile.name}` : "Nhập .SRT"}
              </button>
              {customSrtFile && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomSrtFile(null);
                    if (srtFileInputRef.current) srtFileInputRef.current.value = "";
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#f87171",
                    fontSize: "0.8rem",
                    cursor: "pointer",
                    padding: "0 4px",
                  }}
                  title="Xóa file SRT đã chọn"
                >
                  ✕
                </button>
              )}

              {/* Toggle Subtitle Overlay & Burn-in */}
              <button
                type="button"
                className={`capcut-tool-btn ${showSubtitles ? "active" : ""}`}
                onClick={() => setShowSubtitles(!showSubtitles)}
                title="Bật/Tắt chèn dòng phụ đề chạy theo giọng đọc AI (vị trí tùy chỉnh theo khung kéo)"
              >
                💬 Phụ Đề Lồng Tiếng: {showSubtitles ? "ON" : "OFF"}
              </button>

              {/* Toggle Auto In-Place Overlay Badge */}
              <button
                type="button"
                className={`capcut-tool-btn ${autoInplaceOverlay ? "active" : ""}`}
                onClick={() => setAutoInplaceOverlay(!autoInplaceOverlay)}
                style={{
                  background: autoInplaceOverlay ? "rgba(99, 102, 241, 0.25)" : "rgba(255, 255, 255, 0.05)",
                  borderColor: autoInplaceOverlay ? "#6366f1" : "rgba(255, 255, 255, 0.1)",
                  color: autoInplaceOverlay ? "#a5b4fc" : "#94a3b8",
                  fontWeight: 700,
                }}
                title="AI tự động nhận diện mọi vị trí chữ trên video (banner, câu nói, cảnh báo...), dịch tiếng Việt và tạo thẻ đè tại chỗ"
              >
                🏷️ Tự Động Đè Tại Chỗ: {autoInplaceOverlay ? "BẬT" : "TẮT"}
              </button>

              {/* Nút Cài Đặt Kiểu Chữ & Khung Đè CapCut khi BẬT Tự Động Đè */}
              {autoInplaceOverlay && (
                <button
                  type="button"
                  onClick={() => setIsInplaceStyleModalOpen(true)}
                  style={{
                    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.35))",
                    border: "1px solid rgba(168, 85, 247, 0.6)",
                    color: "#f3e8ff",
                    padding: "5px 12px",
                    fontSize: "0.78rem",
                    fontWeight: 700,
                    borderRadius: "6px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    boxShadow: "0 0 10px rgba(168, 85, 247, 0.3)",
                    transition: "all 0.2s ease",
                  }}
                  title="Tùy chỉnh cỡ chữ, màu sắc, màu nền khung và các kiểu CapCut cho phụ đề đè tại chỗ"
                >
                  <span>🎨</span> Kiểu Chữ & Khung (CapCut)
                </button>
              )}

              {/* Toggle Automatic Subtitle Removal */}
              <button
                type="button"
                className={`capcut-tool-btn ${removeSubtitles ? "active" : ""}`}
                onClick={() => setRemoveSubtitles(!removeSubtitles)}
                style={{
                  background: removeSubtitles ? "rgba(16, 185, 129, 0.2)" : "rgba(255, 255, 255, 0.05)",
                  borderColor: removeSubtitles ? "#10b981" : "rgba(255, 255, 255, 0.1)",
                  color: removeSubtitles ? "#34d399" : "#94a3b8",
                  fontWeight: 700,
                }}
                title="Bật/Tắt tính năng xóa chữ/phụ đề gốc cũ trên video"
              >
                ✂️ Xóa Phụ Đề Gốc: {removeSubtitles ? "BẬT" : "TẮT"}
              </button>

              {/* 2 Options khi BẬT Xóa Phụ Đề Gốc */}
              {removeSubtitles && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    backgroundColor: "rgba(0, 0, 0, 0.4)",
                    padding: "3px 6px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSubtitleRemovalMode("auto")}
                    style={{
                      backgroundColor: subtitleRemovalMode === "auto" ? "#10b981" : "transparent",
                      color: subtitleRemovalMode === "auto" ? "#fff" : "#94a3b8",
                      border: "none",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "0.75rem",
                      fontWeight: subtitleRemovalMode === "auto" ? 700 : 500,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    title="AI tự động nhận diện và xóa phụ đề trên toàn bộ video"
                  >
                    🤖 Tự Động Quét
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSubtitleRemovalMode("manual");
                      if (manualRegions.length === 0) {
                        setIsManualEditorOpen(true);
                      }
                    }}
                    style={{
                      backgroundColor: subtitleRemovalMode === "manual" ? "#ef4444" : "transparent",
                      color: subtitleRemovalMode === "manual" ? "#fff" : "#94a3b8",
                      border: "none",
                      borderRadius: "6px",
                      padding: "4px 8px",
                      fontSize: "0.75rem",
                      fontWeight: subtitleRemovalMode === "manual" ? 700 : 500,
                      cursor: "pointer",
                      transition: "all 0.2s ease",
                    }}
                    title="Tự vẽ khung và chọn thời gian bắt đầu/kết thúc để xóa chính xác 100%"
                  >
                    🎯 Khung Được Chọn
                  </button>

                  {/* Engine AI Selector: Big-LaMa CUDA vs DirectML ONNX */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "3px",
                      marginLeft: "4px",
                      paddingLeft: "6px",
                      borderLeft: "1px solid rgba(255, 255, 255, 0.15)",
                    }}
                  >
                    <span style={{ fontSize: "0.7rem", color: "#64748b", marginRight: "2px" }}>Engine:</span>
                    {(() => {
                      const isBigLamaDownloaded = !!modelsStatus.big_lama?.downloaded;
                      const isDirectMlDownloaded = !!modelsStatus.directml_onnx?.downloaded;

                      return (
                        <>
                          <button
                            type="button"
                            onClick={() => setSubtitleRemovalEngine("frosted_glass")}
                            style={{
                              backgroundColor: subtitleRemovalEngine === "frosted_glass" ? "#0ea5e9" : "transparent",
                              color: subtitleRemovalEngine === "frosted_glass" ? "#fff" : "#94a3b8",
                              border: "1px solid " + (subtitleRemovalEngine === "frosted_glass" ? "#38bdf8" : "transparent"),
                              borderRadius: "5px",
                              padding: "2px 7px",
                              fontSize: "0.72rem",
                              fontWeight: subtitleRemovalEngine === "frosted_glass" ? 700 : 500,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              transition: "all 0.2s ease",
                            }}
                            title="Xóa phụ đề bằng Khung Kính Mờ Trong Suốt (Frosted Glass) chuẩn CapCut / Netflix: Xóa sạch 100% không tì vết, nhìn xuyên thấu nền video cực đẹp, siêu tốc 2s"
                          >
                            <span>✨ Kính Mờ (Đẹp nhất)</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSubtitleRemovalEngine("big_lama");
                              if (!isBigLamaDownloaded) {
                                setDownloadModalKey("big_lama");
                              }
                            }}
                            style={{
                              backgroundColor: subtitleRemovalEngine === "big_lama" ? "#6366f1" : "transparent",
                              color: subtitleRemovalEngine === "big_lama" ? "#fff" : "#94a3b8",
                              border: "1px solid " + (subtitleRemovalEngine === "big_lama" ? "#818cf8" : "transparent"),
                              borderRadius: "5px",
                              padding: "2px 7px",
                              fontSize: "0.72rem",
                              fontWeight: subtitleRemovalEngine === "big_lama" ? 700 : 500,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              transition: "all 0.2s ease",
                            }}
                            title="Chạy Big-LaMa chuẩn trên PyTorch CUDA (Tối ưu cho card rời NVIDIA)"
                          >
                            <span>🔥 Big-LaMa</span>
                            {!isBigLamaDownloaded && (
                              <span style={{ fontSize: "0.65rem", opacity: 0.85, color: "#fef08a" }}>📥 196M</span>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setSubtitleRemovalEngine("directml_onnx");
                              if (!isDirectMlDownloaded) {
                                setDownloadModalKey("directml_onnx");
                              }
                            }}
                            style={{
                              backgroundColor: subtitleRemovalEngine === "directml_onnx" ? "#10b981" : "transparent",
                              color: subtitleRemovalEngine === "directml_onnx" ? "#fff" : "#94a3b8",
                              border: "1px solid " + (subtitleRemovalEngine === "directml_onnx" ? "#34d399" : "transparent"),
                              borderRadius: "5px",
                              padding: "2px 7px",
                              fontSize: "0.72rem",
                              fontWeight: subtitleRemovalEngine === "directml_onnx" ? 700 : 500,
                              cursor: "pointer",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                              transition: "all 0.2s ease",
                            }}
                            title="Chạy LaMa qua DirectML ONNX (Siêu nhẹ, tiết kiệm VRAM cho GPU yếu / Laptop)"
                          >
                            <span>⚡ DirectML ONNX</span>
                            {!isDirectMlDownloaded && (
                              <span style={{ fontSize: "0.65rem", opacity: 0.85, color: "#fef08a" }}>📥 197M</span>
                            )}
                          </button>
                        </>
                      );
                    })()}
                  </div>

                  {/* Nút Cài đặt khung xóa khi ở mode manual */}
                  {subtitleRemovalMode === "manual" && (
                    <button
                      type="button"
                      onClick={() => setIsManualEditorOpen(true)}
                      style={{
                        backgroundColor: "rgba(239, 68, 68, 0.2)",
                        border: "1px solid rgba(239, 68, 68, 0.4)",
                        borderRadius: "6px",
                        color: "#fca5a5",
                        padding: "4px 10px",
                        fontSize: "0.75rem",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                      title="Mở giao diện vẽ khung và cài đặt thời gian xóa"
                    >
                      ✏️ Cài Đặt Khung ({manualRegions.length})
                    </button>
                  )}
                </div>
              )}

              {/* Subtitle Color Switcher */}
              <button
                type="button"
                className="capcut-tool-btn"
                onClick={() => {
                  const nextTheme = subColorTheme === "yellow" ? "white" : subColorTheme === "white" ? "cyan" : "yellow";
                  setSubColorTheme(nextTheme);
                }}
                title="Đổi màu sắc hiển thị của chữ phụ đề trên video"
              >
                🎨 Màu Chữ: {subColorTheme === "yellow" ? "Vàng" : subColorTheme === "white" ? "Trắng" : "Xanh"}
              </button>
            </div>

            {/* Right Group: Action Downloads */}
            <div className="capcut-tool-group">
              {isCompleted && (
                <a
                  href={resultVideoUrl}
                  download
                  className="btn btn-primary btn-sm"
                  style={{ padding: "6px 14px", fontSize: "0.82rem" }}
                >
                  ⬇️ Tải Video Lồng Tiếng
                </a>
              )}
              {isCompleted && (
                <button
                  type="button"
                  onClick={() => {
                    setCaptionModalTab("caption");
                    setShowCaptionModal(true);
                  }}
                  className="btn btn-sm"
                  style={{
                    background: "linear-gradient(135deg, rgba(99, 102, 241, 0.25), rgba(168, 85, 247, 0.35))",
                    border: "1px solid rgba(168, 85, 247, 0.6)",
                    color: "#f3e8ff",
                    fontWeight: 700,
                    padding: "6px 14px",
                    fontSize: "0.82rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "0 0 12px rgba(168, 85, 247, 0.25)",
                  }}
                  title="Dùng Gemini AI tạo ngay tiêu đề giật tít, bài viết mô tả Fanpage & hashtags"
                >
                  ✨ Tạo Caption Fanpage (AI)
                </button>
              )}
              {isCompleted && (
                <button
                  type="button"
                  onClick={() => {
                    setCaptionModalTab("comment");
                    setShowCaptionModal(true);
                  }}
                  className="btn btn-sm"
                  style={{
                    background: "linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(6, 182, 212, 0.35))",
                    border: "1px solid rgba(16, 185, 129, 0.6)",
                    color: "#a7f3d0",
                    fontWeight: 700,
                    padding: "6px 14px",
                    fontSize: "0.82rem",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    boxShadow: "0 0 12px rgba(16, 185, 129, 0.25)",
                  }}
                  title="Dùng Gemini AI viết các đoạn comment ghim kèm link tiếp thị Shopee / TikTok Shop"
                >
                  💬 Tạo Cmt Gắn Link (AI)
                </button>
              )}
              {activeTask?.translated_srt_path && isCompleted && (
                <a
                  href={`${API_BASE}/${activeTask.translated_srt_path.replace(/\\/g, "/")}`}
                  download={`subtitles_vi_${activeTask.id}.srt`}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: "6px 12px", fontSize: "0.82rem" }}
                  title="Tải file phụ đề Tiếng Việt (.SRT)"
                >
                  🇻🇳 Tải SRT
                </a>
              )}
              {activeTask?.original_srt_path && (
                <a
                  href={`${API_BASE}/${activeTask.original_srt_path.replace(/\\/g, "/")}`}
                  download={`subtitles_original_${activeTask.id}.srt`}
                  className="btn btn-secondary btn-sm"
                  style={{ padding: "6px 12px", fontSize: "0.82rem" }}
                  title="Tải file phụ đề gốc nhận diện từ video (.SRT)"
                >
                  🌐 Tải SRT Gốc
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Bottom: Terminal Log Console (pipeline.log) */}
        <div
          style={{
            background: "#070b14",
            border: "1px solid rgba(99, 102, 241, 0.25)",
            borderRadius: "12px",
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
          }}
        >
          {/* Terminal Title Bar */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "9px 14px",
              background: "rgba(15, 23, 42, 0.85)",
              borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444", display: "inline-block" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
              </div>
              <span style={{ marginLeft: 4, fontSize: "0.8rem", color: "#818cf8", fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                🖥️ Nhật Ký Tiến Trình Lồng Tiếng (pipeline.log)
              </span>
              <span
                style={{
                  fontSize: "0.68rem",
                  padding: "2px 8px",
                  borderRadius: "12px",
                  background: isProcessing ? "rgba(99, 102, 241, 0.2)" : isCompleted ? "rgba(34, 197, 94, 0.15)" : "rgba(148, 163, 184, 0.1)",
                  color: isProcessing ? "#818cf8" : isCompleted ? "#4ade80" : "#94a3b8",
                  border: isProcessing ? "1px solid rgba(99, 102, 241, 0.3)" : isCompleted ? "1px solid rgba(34, 197, 94, 0.3)" : "1px solid rgba(255, 255, 255, 0.06)",
                  fontWeight: 600,
                }}
              >
                {isProcessing ? "● Đang xử lý" : isCompleted ? "● Hoàn tất" : "● Sẵn sàng"}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontSize: "0.72rem", color: "#64748b", fontFamily: "monospace" }}>
                {logLines.length} dòng nhật ký
              </span>
              {logLines.length > 0 && (
                <button
                  type="button"
                  onClick={() => setLogLines([])}
                  style={{
                    background: "rgba(255, 255, 255, 0.05)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    color: "#94a3b8",
                    fontSize: "0.72rem",
                    cursor: "pointer",
                    padding: "2px 8px",
                    borderRadius: "4px",
                  }}
                >
                  Xóa nhật ký
                </button>
              )}
            </div>
          </div>

          {/* Terminal Output Body */}
          <div
            ref={logContainerRef}
            style={{
              padding: "12px 16px",
              height: "200px",
              overflowY: "auto",
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
              fontSize: "0.76rem",
              lineHeight: "1.7",
              background: "#060a12",
            }}
          >
            <div style={{ color: "#475569", marginBottom: "4px" }}>
              $ Hệ thống giám sát tiến trình Studio Mini đã sẵn sàng [UTF-8]
            </div>
            {logLines.length === 0 ? (
              <div style={{ color: "#334155" }}>
                $ Chờ lệnh &quot;Bắt Đầu Lồng Tiếng AI&quot; từ bảng điều khiển bên trái...
              </div>
            ) : (
              logLines.map((line, i) => {
                let c = "#a3e635";
                if (line.includes("✅")) c = "#4ade80";
                if (line.includes("❌")) c = "#f87171";
                if (line.includes("🚀")) c = "#60a5fa";
                return (
                  <div key={i} style={{ color: c }}>
                    {line}
                  </div>
                );
              })
            )}
          </div>

          {/* Subtitles Accordion: Only shown when task is completed or custom SRT loaded */}
          {segments.length > 0 && (
            <details
              style={{
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                background: "rgba(15, 23, 42, 0.6)",
              }}
            >
              <summary
                style={{
                  padding: "8px 16px",
                  fontSize: "0.8rem",
                  fontWeight: 600,
                  color: "#93c5fd",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                📋 Kịch Bản & Timeline Phụ Đề ({segments.length} câu)
              </summary>
              <div
                style={{
                  maxHeight: "220px",
                  overflowY: "auto",
                  padding: "8px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                }}
              >
                {segments.map((seg) => {
                  const st = seg.actual_start ?? seg.start;
                  const en = seg.actual_end ?? seg.end;
                  const isPlayingCurrent = currentTime >= st && currentTime <= en;
                  return (
                    <div
                      key={seg.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        padding: "6px 10px",
                        background: isPlayingCurrent ? "rgba(99, 102, 241, 0.2)" : "rgba(15, 23, 42, 0.8)",
                        border: isPlayingCurrent ? "1px solid rgba(99, 102, 241, 0.4)" : "1px solid rgba(255, 255, 255, 0.05)",
                        borderRadius: "6px",
                        fontSize: "0.78rem",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleSeekVideo(st)}
                        style={{
                          background: "rgba(99, 102, 241, 0.2)",
                          border: "1px solid rgba(99, 102, 241, 0.3)",
                          color: "#a5b4fc",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          fontFamily: "monospace",
                          fontSize: "0.72rem",
                          cursor: "pointer",
                          whiteSpace: "nowrap",
                        }}
                      >
                        ▶ [{formatTimecode(st)} ➔ {formatTimecode(en)}]
                      </button>
                      <span style={{ color: "#64748b", fontSize: "0.74rem" }}>{seg.text}</span>
                      <input
                        type="text"
                        value={seg.translated_text || seg.text || ""}
                        onChange={(e) => handleUpdateSubtitleText(seg.id, e.target.value)}
                        className="capcut-sub-trans-input"
                        style={{ flex: 1, padding: "3px 8px", fontSize: "0.78rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteSubtitle(seg.id)}
                        className="capcut-sub-del"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </div>
      </main>

      {/* Modal Tạo Caption & Comment Fanpage bằng Gemini AI */}
      <CaptionModal
        isOpen={showCaptionModal}
        onClose={() => setShowCaptionModal(false)}
        taskId={activeTask?.id || null}
        videoTitle={selectedVideo?.name || activeTask?.video_filename}
        initialTab={captionModalTab}
      />

      {/* Modal Tải Video Douyin, TikTok, Kuaishou, Bilibili... */}
      <VideoDownloaderModal
        isOpen={showDownloaderModal}
        onClose={() => setShowDownloaderModal(false)}
        onSelectVideoForStudio={(file, previewUrl) => {
          setSelectedVideo(file);
          setVideoPreviewUrl(previewUrl);
        }}
      />

      {/* Modal Chọn Khung Hình & Thời Gian Xóa Phụ Đề Thủ Công */}
      <ManualRemovalEditorModal
        isOpen={isManualEditorOpen}
        onClose={() => setIsManualEditorOpen(false)}
        videoSrc={videoPreviewUrl}
        videoDuration={duration}
        regions={manualRegions}
        onSaveRegions={(newRegions) => {
          setManualRegions(newRegions);
        }}
      />

      {/* Modal Tùy Chỉnh Kiểu Chữ & Khung Đè Chuẩn CapCut */}
      <InplaceStyleModal
        isOpen={isInplaceStyleModalOpen}
        onClose={() => setIsInplaceStyleModalOpen(false)}
        style={inplaceStyle}
        onChangeStyle={handleUpdateInplaceStyle}
      />

      {/* Modal Tải Mô Hình AI Theo Yêu Cầu */}
      <ModelDownloadModal
        isOpen={downloadModalKey !== null}
        modelKey={downloadModalKey || "big_lama"}
        modelInfo={downloadModalKey ? modelsStatus[downloadModalKey] : undefined}
        onClose={() => setDownloadModalKey(null)}
        onDownloadComplete={() => {
          fetchModelsStatus();
          setDownloadModalKey(null);
        }}
      />
    </div>
  );
};
