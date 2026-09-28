"use client";

import React, { useState, useRef, useEffect } from "react";
import { API_BASE } from "@/config";

interface Box {
  id: string;
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
  label: string;
}

interface SubtitleRemoverProps {
  onSendToDubbing?: (videoUrl: string, originalFile?: File | null) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms}`;
}

export const SubtitleRemover: React.FC<SubtitleRemoverProps> = ({ onSendToDubbing }) => {
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [serverVideoPath, setServerVideoPath] = useState<string | null>(null);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number } | null>(null);

  // Chế độ tự động nhận diện chữ AI (VSR Engine: YOLO-Text + Big-LaMa)
  const [autoDetect, setAutoDetect] = useState<boolean>(true);
  const [boxes, setBoxes] = useState<Box[]>([]);

  // Player controls
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentDraftBox, setCurrentDraftBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Preview & Processing state
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [detectedTexts, setDetectedTexts] = useState<string[]>([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewMode, setPreviewMode] = useState<"after" | "before">("after");

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [completedVideoUrl, setCompletedVideoUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  // Bộ đếm thời gian thực khi xử lý video
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const formatElapsed = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) {
      return `${m} phút ${s < 10 ? "0" : ""}${s} giây`;
    }
    return `${s} giây`;
  };

  const formatElapsedBadge = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m > 0 ? `${m}m ` : ""}${s < 10 && m > 0 ? "0" : ""}${s}s`;
  };

  // Tự động kích hoạt nạp ngầm mô hình khi mở tab Xóa Phụ Đề
  useEffect(() => {
    fetch(`${API_BASE}/api/subtitle-remover/warmup`, { method: "POST" }).catch(() => {});
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const handleVideoSelect = (file: File) => {
    if (!file.type.startsWith("video/")) {
      alert("Vui lòng chọn file video hợp lệ (.mp4, .mov, .mkv)");
      return;
    }
    // Kích hoạt nạp ngầm ngay khi người dùng chọn video
    fetch(`${API_BASE}/api/subtitle-remover/warmup`, { method: "POST" }).catch(() => {});

    const url = URL.createObjectURL(file);
    setSelectedVideo(file);
    setVideoPreviewUrl(url);
    setServerVideoPath(null);
    setCompletedVideoUrl(null);
    setErrorMsg(null);
    setPreviewImage(null);
    setDetectedTexts([]);
    setProgress(0);
    setCurrentTime(0);
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration || 0);
      setVideoDimensions({
        width: videoRef.current.videoWidth,
        height: videoRef.current.videoHeight,
      });
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
    }
  };

  // Mouse drawing on overlay (for manual extra box)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setIsDrawing(true);
    setDrawStart({ x, y });
    setCurrentDraftBox({ x, y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    const curX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const curY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const x = Math.min(drawStart.x, curX);
    const y = Math.min(drawStart.y, curY);
    const w = Math.abs(curX - drawStart.x);
    const h = Math.abs(curY - drawStart.y);

    setCurrentDraftBox({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (isDrawing && currentDraftBox) {
      if (currentDraftBox.w > 0.02 && currentDraftBox.h > 0.02) {
        const newBox: Box = {
          id: `box_${Date.now()}`,
          ...currentDraftBox,
          label: `Vùng chọn ${boxes.length + 1}`,
        };
        setBoxes((prev) => [...prev, newBox]);
      }
    }
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentDraftBox(null);
  };

  const removeBox = (id: string) => {
    setBoxes((prev) => prev.filter((b) => b.id !== id));
  };

  // Preview 1 frame with AI OCR + LaMa
  const handlePreviewFrame = async () => {
    if (!selectedVideo && !serverVideoPath) {
      alert("Vui lòng tải lên video trước khi xem thử.");
      return;
    }

    setIsPreviewLoading(true);
    setErrorMsg(null);
    try {
      const formData = new FormData();
      if (serverVideoPath) {
        formData.append("video_path", serverVideoPath);
      } else if (selectedVideo) {
        formData.append("video_file", selectedVideo);
      }
      formData.append("boxes", JSON.stringify(boxes));
      formData.append("auto_detect", autoDetect ? "true" : "false");
      formData.append("timestamp", currentTime.toString());

      const res = await fetch(`${API_BASE}/api/subtitle-remover/preview`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo bản xem trước.");
      }

      const data = await res.json();
      setPreviewImage(data.preview_image);
      setDetectedTexts(data.detected_texts || []);
      if (data.video_path) {
        setServerVideoPath(data.video_path);
      }
      setShowPreviewModal(true);
    } catch (e: any) {
      setErrorMsg(e.message || "Lỗi khi tạo bản xem trước.");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  // Start processing whole video with AI Inpainting
  const handleStartRemoval = async () => {
    if (!selectedVideo && !serverVideoPath) {
      alert("Vui lòng chọn video cần xóa chữ.");
      return;
    }
    if (!autoDetect && boxes.length === 0) {
      alert("Vui lòng bật Chế độ Tự Động hoặc khoanh ít nhất 1 vùng chữ cần xóa.");
      return;
    }

    setIsProcessing(true);
    setProgress(3);
    setCurrentStep("Đang chuẩn bị tiến trình xóa chữ...");
    setErrorMsg(null);
    setCompletedVideoUrl(null);

    // Bắt đầu đếm thời gian thực ngay khi người dùng nhấn nút
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);

    try {
      const formData = new FormData();
      if (serverVideoPath) {
        formData.append("video_path", serverVideoPath);
      } else if (selectedVideo) {
        formData.append("video_file", selectedVideo);
      }
      formData.append("boxes", JSON.stringify(boxes));
      formData.append("auto_detect", autoDetect ? "true" : "false");

      const res = await fetch(`${API_BASE}/api/subtitle-remover/start`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể khởi chạy xóa chữ.");
      }

      const data = await res.json();
      const taskId = data.task_id;

      // Start polling
      pollingRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(`${API_BASE}/api/subtitle-remover/status/${taskId}`);
          if (!pollRes.ok) return;
          const pollData = await pollRes.json();

          setProgress(pollData.progress || 0);
          setCurrentStep(pollData.current_step || "Đang xử lý...");

          if (pollData.status === "completed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setIsProcessing(false);
            setProgress(100);
            setCurrentStep("Xóa chữ hoàn tất 100%!");
            const finalUrl = `${API_BASE}/${pollData.output_path}`;
            setCompletedVideoUrl(finalUrl);
          } else if (pollData.status === "failed") {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (timerRef.current) {
              clearInterval(timerRef.current);
              timerRef.current = null;
            }
            setIsProcessing(false);
            setErrorMsg(pollData.error || "Xử lý xóa chữ thất bại.");
          }
        } catch {
          // ignore network glitches
        }
      }, 1000);
    } catch (e: any) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsProcessing(false);
      setErrorMsg(e.message || "Lỗi khởi chạy tiến trình.");
    }
  };

  return (
    <div className="subtitle-remover-container" style={{ padding: "20px", maxWidth: "1400px", margin: "0 auto" }}>
      {/* Top banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "linear-gradient(135deg, rgba(30, 41, 59, 0.8), rgba(15, 23, 42, 0.95))",
          padding: "16px 24px",
          borderRadius: "16px",
          border: "1px solid rgba(255, 255, 255, 0.08)",
          marginBottom: "20px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
              Xóa Chữ & Phụ Đề Video Tự Động
            </h2>
          </div>
          <p style={{ fontSize: "0.85rem", color: "#94a3b8", margin: 0 }}>
            Tự động quét và xóa sạch phụ đề, chữ chèn trên video mà không để lại vết mờ.
          </p>
        </div>

        {/* Auto Detect Switch & Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              cursor: "pointer",
              background: autoDetect ? "rgba(16, 185, 129, 0.18)" : "rgba(255, 255, 255, 0.06)",
              border: autoDetect ? "1px solid #10b981" : "1px solid rgba(255, 255, 255, 0.12)",
              padding: "8px 14px",
              borderRadius: "10px",
              transition: "all 0.2s ease",
            }}
          >
            <input
              type="checkbox"
              checked={autoDetect}
              onChange={(e) => setAutoDetect(e.target.checked)}
              style={{ accentColor: "#10b981", width: "16px", height: "16px", cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.85rem", fontWeight: 700, color: autoDetect ? "#34d399" : "#94a3b8" }}>
              🤖 Tự Động Nhận Diện Chữ AI
            </span>
          </label>

          {boxes.length > 0 && (
            <button
              type="button"
              onClick={() => setBoxes([])}
              className="capcut-preset-btn-danger"
              title="Xóa các vùng thủ công đã chọn"
            >
              🗑️ Xóa Vùng ({boxes.length})
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: "20px", alignItems: "start" }}>
        {/* Left Column: Video Player & Interactive Canvas */}
        <div
          style={{
            background: "#0c101d",
            borderRadius: "16px",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* Video / Drop Area */}
          {!videoPreviewUrl ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                if (e.dataTransfer.files?.[0]) {
                  handleVideoSelect(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%",
                height: "460px",
                border: isDragOver ? "2px dashed #10b981" : "2px dashed rgba(255, 255, 255, 0.15)",
                borderRadius: "12px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                background: isDragOver ? "rgba(16, 185, 129, 0.08)" : "rgba(15, 23, 42, 0.4)",
                transition: "all 0.2s ease",
              }}
            >
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: "none" }}
                accept="video/*"
                onChange={(e) => e.target.files?.[0] && handleVideoSelect(e.target.files[0])}
              />
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  borderRadius: "50%",
                  background: "rgba(16, 185, 129, 0.15)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: "16px",
                  color: "#34d399",
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="23 7 16 12 23 17 23 7"></polygon>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                </svg>
              </div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "#f8fafc", marginBottom: "6px" }}>
                Kéo & thả video cần xóa chữ vào đây
              </h3>
              <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "16px" }}>
                AI sẽ tự quét tìm chữ ở mọi vị trí trên video Douyin / TikTok mà bạn không cần khoanh vùng.
              </p>
              <button
                type="button"
                style={{
                  padding: "8px 18px",
                  background: "linear-gradient(135deg, #10b981, #059669)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                }}
              >
                📁 Hoặc Bấm Chọn File Video
              </button>
            </div>
          ) : (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center" }}>
              {/* Interactive Video Box */}
              <div
                style={{
                  position: "relative",
                  maxWidth: "100%",
                  maxHeight: "540px",
                  display: "inline-block",
                  overflow: "hidden",
                  borderRadius: "10px",
                  backgroundColor: "#000",
                  boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                }}
              >
                <video
                  ref={videoRef}
                  src={completedVideoUrl || videoPreviewUrl}
                  onLoadedMetadata={handleLoadedMetadata}
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                  style={{
                    maxHeight: "540px",
                    maxWidth: "100%",
                    display: "block",
                    userSelect: "none",
                  }}
                  playsInline
                />

                {/* Drawing & Bounding Box Overlay */}
                {!completedVideoUrl && (
                  <div
                    ref={overlayRef}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      cursor: "crosshair",
                      userSelect: "none",
                      zIndex: 10,
                    }}
                  >
                    {/* Render existing manual boxes */}
                    {boxes.map((box, index) => (
                      <div
                        key={box.id}
                        style={{
                          position: "absolute",
                          left: `${box.x * 100}%`,
                          top: `${box.y * 100}%`,
                          width: `${box.w * 100}%`,
                          height: `${box.h * 100}%`,
                          border: "2px dashed #f43f5e",
                          backgroundColor: "rgba(244, 63, 94, 0.25)",
                          backdropFilter: "blur(1px)",
                          boxSizing: "border-box",
                          pointerEvents: "auto",
                          display: "flex",
                          justifyContent: "space-between",
                          padding: "2px 4px",
                        }}
                      >
                        <span
                          style={{
                            background: "rgba(244, 63, 94, 0.9)",
                            color: "#fff",
                            fontSize: "0.68rem",
                            fontWeight: 700,
                            padding: "1px 4px",
                            borderRadius: "3px",
                            alignSelf: "flex-start",
                            pointerEvents: "none",
                          }}
                        >
                          {box.label || `Vùng ${index + 1}`}
                        </span>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeBox(box.id);
                          }}
                          style={{
                            background: "rgba(0, 0, 0, 0.75)",
                            color: "#fff",
                            border: "none",
                            borderRadius: "50%",
                            width: "18px",
                            height: "18px",
                            fontSize: "11px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            lineHeight: 1,
                          }}
                          title="Xóa vùng này"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    {/* Render active dragging box */}
                    {isDrawing && currentDraftBox && (
                      <div
                        style={{
                          position: "absolute",
                          left: `${currentDraftBox.x * 100}%`,
                          top: `${currentDraftBox.y * 100}%`,
                          width: `${currentDraftBox.w * 100}%`,
                          height: `${currentDraftBox.h * 100}%`,
                          border: "2px solid #38bdf8",
                          backgroundColor: "rgba(56, 189, 248, 0.25)",
                          pointerEvents: "none",
                        }}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Player Scrubber & Transport Controls */}
              <div
                style={{
                  width: "100%",
                  marginTop: "12px",
                  background: "rgba(15, 23, 42, 0.6)",
                  padding: "10px 16px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255, 255, 255, 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
                  <button
                    type="button"
                    onClick={togglePlay}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#f8fafc",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "4px",
                    }}
                  >
                    {isPlaying ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    )}
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={duration || 100}
                    step={0.1}
                    value={currentTime}
                    onChange={handleSeek}
                    style={{ flex: 1, accentColor: "#10b981", cursor: "pointer" }}
                  />

                  <span style={{ fontSize: "0.82rem", fontFamily: "monospace", color: "#94a3b8" }}>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: "0.78rem", color: "#64748b" }}>
                    💡 Kéo thanh trượt đến bất kỳ giây nào có chữ, rồi bấm "Xem Thử 1 Khung Hình" bên phải
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#34d399",
                      fontSize: "0.78rem",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Đổi Video Khác
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: AI Config & Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* AI Detection Status Card */}
          <div
            style={{
              background: "#0f172a",
              borderRadius: "16px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "16px",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
                paddingBottom: "8px",
              }}
            >
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>
                Cơ Chế Xóa Chữ
              </h3>
              <span style={{ fontSize: "0.75rem", color: "#34d399", fontWeight: 700 }}>
                ⚡ GPU CUDA (GTX 1650)
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={{
                  background: autoDetect ? "rgba(16, 185, 129, 0.1)" : "rgba(255, 255, 255, 0.04)",
                  border: autoDetect ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(255, 255, 255, 0.06)",
                  padding: "10px 12px",
                  borderRadius: "10px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "1rem" }}>🤖</span>
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#f8fafc" }}>
                    Tự Động Quét & Xóa AI (Khuyên Dùng)
                  </span>
                </div>
                <p style={{ fontSize: "0.76rem", color: "#94a3b8", margin: 0, lineHeight: 1.4 }}>
                  Tự động phát hiện và xóa sạch chữ trên từng khung hình của video.
                  Không cần khoanh vùng thủ công.
                </p>
              </div>

              {boxes.length > 0 && (
                <div style={{ marginTop: "4px" }}>
                  <div style={{ fontSize: "0.8rem", color: "#cbd5e1", fontWeight: 600, marginBottom: "6px" }}>
                    Vùng khoanh thủ công bổ sung ({boxes.length}):
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "120px", overflowY: "auto" }}>
                    {boxes.map((b) => (
                      <div
                        key={b.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          background: "rgba(255, 255, 255, 0.04)",
                          padding: "6px 10px",
                          borderRadius: "6px",
                          fontSize: "0.76rem",
                        }}
                      >
                        <span style={{ color: "#f8fafc" }}>{b.label}</span>
                        <button
                          type="button"
                          onClick={() => removeBox(b.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            fontSize: "0.75rem",
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Action Card */}
          <div
            style={{
              background: "#0f172a",
              borderRadius: "16px",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <h3 style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f8fafc", margin: 0 }}>Thao Tác Xóa Chữ</h3>

            {/* Test 1 frame */}
            <button
              type="button"
              disabled={!videoPreviewUrl || isPreviewLoading || isProcessing}
              onClick={handlePreviewFrame}
              style={{
                width: "100%",
                padding: "11px 16px",
                background: "rgba(16, 185, 129, 0.15)",
                border: "1px solid rgba(16, 185, 129, 0.4)",
                color: "#a7f3d0",
                borderRadius: "10px",
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: !videoPreviewUrl || isPreviewLoading || isProcessing ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                opacity: !videoPreviewUrl ? 0.6 : 1,
              }}
            >
              {isPreviewLoading ? (
                <>⏳ Đang xử lý xóa thử khung hình...</>
              ) : (
                <>👁️ Xem Thử 1 Khung Hình (Tại {formatTime(currentTime)})</>
              )}
            </button>

            {/* Start Full video */}
            <button
              type="button"
              disabled={!videoPreviewUrl || isProcessing}
              onClick={handleStartRemoval}
              style={{
                width: "100%",
                padding: "13px 16px",
                background: "linear-gradient(135deg, #10b981, #059669)",
                border: "none",
                color: "#ffffff",
                borderRadius: "10px",
                fontWeight: 700,
                fontSize: "0.95rem",
                cursor: !videoPreviewUrl || isProcessing ? "not-allowed" : "pointer",
                boxShadow: "0 4px 14px rgba(16, 185, 129, 0.35)",
                opacity: !videoPreviewUrl || isProcessing ? 0.6 : 1,
              }}
            >
              {isProcessing
                ? `⏳ Đang Xóa Chữ... (⏱️ ${formatElapsedBadge(elapsedSeconds)})`
                : "🚀 Bắt Đầu Xóa Chữ Toàn Video (AI)"}
            </button>

            {/* Processing Progress */}
            {isProcessing && (
              <div style={{ marginTop: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem", marginBottom: "4px" }}>
                  <span style={{ color: "#f8fafc" }}>{currentStep}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      style={{
                        background: "rgba(16, 185, 129, 0.2)",
                        border: "1px solid rgba(16, 185, 129, 0.4)",
                        color: "#6ee7b7",
                        padding: "2px 7px",
                        borderRadius: "6px",
                        fontFamily: "monospace",
                        fontWeight: 600,
                        fontSize: "0.78rem",
                      }}
                    >
                      ⏱️ {formatElapsedBadge(elapsedSeconds)}
                    </span>
                    <span style={{ color: "#34d399", fontWeight: 700 }}>{progress}%</span>
                  </div>
                </div>
                <div
                  style={{
                    width: "100%",
                    height: "8px",
                    background: "rgba(255, 255, 255, 0.1)",
                    borderRadius: "4px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${progress}%`,
                      height: "100%",
                      background: "linear-gradient(90deg, #10b981, #34d399)",
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
              </div>
            )}

            {/* Error message */}
            {errorMsg && (
              <div
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  color: "#f87171",
                  padding: "10px",
                  borderRadius: "8px",
                  fontSize: "0.82rem",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>⚠️ {errorMsg}</span>
                  {elapsedSeconds > 0 && (
                    <span style={{ fontSize: "0.75rem", color: "#fca5a5" }}>
                      (sau {formatElapsed(elapsedSeconds)})
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Completed Result Actions */}
            {completedVideoUrl && (
              <div
                style={{
                  background: "rgba(16, 185, 129, 0.15)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: "12px",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  marginTop: "8px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#34d399", fontWeight: 700, fontSize: "0.9rem" }}>
                    <span>✅</span> Xóa chữ hoàn tất 100%!
                  </div>
                  {elapsedSeconds > 0 && (
                    <span
                      style={{
                        background: "rgba(16, 185, 129, 0.25)",
                        border: "1px solid rgba(16, 185, 129, 0.5)",
                        color: "#a7f3d0",
                        padding: "3px 9px",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        fontWeight: 600,
                        fontFamily: "monospace",
                      }}
                    >
                      ⏱️ Thời gian: {formatElapsed(elapsedSeconds)}
                    </span>
                  )}
                </div>

                <a
                  href={completedVideoUrl}
                  download
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "9px 14px",
                    background: "#10b981",
                    color: "#fff",
                    borderRadius: "8px",
                    textAlign: "center",
                    textDecoration: "none",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                  }}
                >
                  ⬇️ Tải Video Sạch Về Máy
                </a>

                {onSendToDubbing && (
                  <button
                    type="button"
                    onClick={() => onSendToDubbing(completedVideoUrl, selectedVideo)}
                    style={{
                      padding: "9px 14px",
                      background: "linear-gradient(135deg, #6366f1, #3b82f6)",
                      color: "#fff",
                      border: "none",
                      borderRadius: "8px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      boxShadow: "0 4px 12px rgba(99, 102, 241, 0.3)",
                    }}
                  >
                    🎬 Chuyển Sang Lồng Tiếng AI (Studio Mini)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal */}
      {showPreviewModal && previewImage && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            backdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "20px",
          }}
          onClick={() => setShowPreviewModal(false)}
        >
          <div
            style={{
              background: "#0f172a",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: "16px",
              padding: "20px",
              maxWidth: "680px",
              width: "100%",
              maxHeight: "90vh",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", width: "100%", marginBottom: "14px", alignItems: "center" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", color: "#f8fafc", fontWeight: 700 }}>
                👁️ So Sánh Khung Hình Sau Khi Xóa Chữ AI
              </h3>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#94a3b8",
                  fontSize: "1.2rem",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* Detected texts badge */}
            {detectedTexts.length > 0 && (
              <div
                style={{
                  background: "rgba(16, 185, 129, 0.12)",
                  border: "1px solid rgba(16, 185, 129, 0.25)",
                  padding: "6px 12px",
                  borderRadius: "8px",
                  marginBottom: "12px",
                  width: "100%",
                  fontSize: "0.78rem",
                  color: "#a7f3d0",
                }}
              >
                <b>🤖 AI đã tự động phát hiện {detectedTexts.length} câu chữ:</b>{" "}
                <span style={{ color: "#fff" }}>{detectedTexts.map((t) => `"${t}"`).join(", ")}</span>
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
              <button
                type="button"
                onClick={() => setPreviewMode("after")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: 600,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  background: previewMode === "after" ? "#10b981" : "rgba(255,255,255,0.08)",
                  color: "#fff",
                }}
              >
                ✨ Sau Khi Xóa (Big-LaMa AI)
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode("before")}
                style={{
                  padding: "6px 14px",
                  borderRadius: "6px",
                  border: "none",
                  fontWeight: 600,
                  fontSize: "0.82rem",
                  cursor: "pointer",
                  background: previewMode === "before" ? "#6366f1" : "rgba(255,255,255,0.08)",
                  color: "#fff",
                }}
              >
                🎬 Khung Hình Gốc Có Chữ
              </button>
            </div>

            <div
              style={{
                position: "relative",
                maxHeight: "560px",
                overflow: "hidden",
                borderRadius: "10px",
                backgroundColor: "#000",
                display: "flex",
                justifyContent: "center",
              }}
            >
              {previewMode === "after" ? (
                <img
                  src={previewImage}
                  alt="Khung hình sau khi xóa chữ"
                  style={{ maxHeight: "560px", maxWidth: "100%", objectFit: "contain" }}
                />
              ) : (
                <video
                  src={videoPreviewUrl || ""}
                  style={{ maxHeight: "560px", maxWidth: "100%", objectFit: "contain" }}
                  onLoadedMetadata={(e) => {
                    (e.target as HTMLVideoElement).currentTime = currentTime;
                  }}
                />
              )}
            </div>

            <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: "12px", textAlign: "center" }}>
              Mô hình Big-LaMa tái tạo lại kết cấu nền thực tế mà không để lại vết mờ hay vệt sọc ngang.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
