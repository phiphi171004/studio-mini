"use client";

import React, { useState, useRef } from "react";
import { API_BASE } from "@/config";

interface VideoInfo {
  title: string;
  video_url: string;
  cover_url: string;
  duration: number;
  platform: string;
  original_url: string;
}

interface VideoDownloaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVideoForStudio?: (file: File, previewUrl: string) => void;
}

export const VideoDownloaderModal: React.FC<VideoDownloaderModalProps> = ({
  isOpen,
  onClose,
  onSelectVideoForStudio,
}) => {
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [downloadSuccessMsg, setDownloadSuccessMsg] = useState("");
  const [detectedDuration, setDetectedDuration] = useState<number>(0);
  const [capturedThumb, setCapturedThumb] = useState<string>("");
  const [imgLoadFailed, setImgLoadFailed] = useState<boolean>(false);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);

  if (!isOpen) return null;

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setInputText(text);
        setErrorMessage("");
      }
    } catch {
      // Trình duyệt không cấp quyền clipboard thì bỏ qua
    }
  };

  const handleFetchInfo = async () => {
    if (!inputText.trim()) {
      setErrorMessage("Vui lòng dán link hoặc đoạn văn bản chia sẻ video.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");
    setDownloadSuccessMsg("");
    setVideoInfo(null);

    try {
      const res = await fetch(`${API_BASE}/api/downloader/info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: inputText.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Không thể phân tích video từ đường link này.");
      }

      setVideoInfo(data);
      setDetectedDuration(data.duration || 0);
      setCapturedThumb("");
      setImgLoadFailed(false);
    } catch (err: any) {
      setErrorMessage(err.message || "Đã xảy ra lỗi khi lấy thông tin video.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownloadToServer = async () => {
    if (!videoInfo) return;

    setIsDownloading(true);
    setErrorMessage("");
    setDownloadSuccessMsg("");

    try {
      const res = await fetch(`${API_BASE}/api/downloader/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoInfo.video_url,
          title: videoInfo.title,
          platform: videoInfo.platform,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Không thể tải video về máy chủ.");
      }

      // Lấy file blob từ server để nạp trực tiếp vào Studio
      const fileUrl = `${API_BASE}${data.file_url}`;
      
      if (onSelectVideoForStudio) {
        setDownloadSuccessMsg("Đang nạp video vào Studio Mini...");
        const videoRes = await fetch(fileUrl);
        const blob = await videoRes.blob();
        const file = new File([blob], data.filename, { type: "video/mp4" });
        onSelectVideoForStudio(file, fileUrl);
        onClose();
      } else {
        setDownloadSuccessMsg("Đã tải video lên hệ thống thành công!");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Tải video thất bại.");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveToComputer = async () => {
    if (!videoInfo) return;

    setIsDownloading(true);
    setErrorMessage("");
    setDownloadSuccessMsg("");

    try {
      // Tải qua server để bypass CORS và watermark
      const res = await fetch(`${API_BASE}/api/downloader/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoInfo.video_url,
          title: videoInfo.title,
          platform: videoInfo.platform,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Không thể tải video về máy.");
      }

      setDownloadSuccessMsg("Đang chuẩn bị file video...");
      const fileUrl = `${API_BASE}${data.file_url}`;
      const blobRes = await fetch(fileUrl);
      if (!blobRes.ok) {
        throw new Error("Không thể đọc file video từ máy chủ.");
      }
      const blob = await blobRes.blob();
      const blobUrl = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = data.filename || "video.mp4";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(blobUrl), 20000);

      setDownloadSuccessMsg("Đã kích hoạt tải video! Hãy bấm nút [Lưu] trên cửa sổ Windows để hoàn tất.");
    } catch (err: any) {
      setErrorMessage(err.message || "Tải video về máy thất bại.");
    } finally {
      setIsDownloading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const getPlatformBadge = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes("douyin")) return { label: "Douyin", bg: "#000000", border: "#ff0050", icon: "🎵" };
    if (p.includes("tiktok")) return { label: "TikTok", bg: "#010101", border: "#00f2fe", icon: "🖤" };
    if (p.includes("kuaishou")) return { label: "Kuaishou", bg: "#ff5000", border: "#ff8400", icon: "⚡" };
    if (p.includes("bilibili")) return { label: "Bilibili", bg: "#00a1d6", border: "#23c9ed", icon: "📺" };
    if (p.includes("xiaohongshu") || p.includes("xhs")) return { label: "Xiaohongshu", bg: "#fe2c55", border: "#ff6584", icon: "📕" };
    return { label: platform.toUpperCase(), bg: "#4f46e5", border: "#6366f1", icon: "🎬" };
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(3, 7, 18, 0.8)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDownloading) onClose();
      }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "640px",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 30px rgba(99, 102, 241, 0.15)",
          overflow: "hidden",
        }}
      >
        {/* Header Modal */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(90deg, rgba(30, 27, 75, 0.6) 0%, rgba(15, 23, 42, 0.8) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "10px",
                background: "linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.2rem",
                boxShadow: "0 4px 12px rgba(236, 72, 153, 0.3)",
              }}
            >
              📥
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc" }}>
                Tải Video Không Logo / Watermark
              </h2>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#94a3b8" }}>
                Hỗ trợ Douyin, TikTok, Xiaohongshu, Kuaishou, Bilibili
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isDownloading}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "1.4rem",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "6px",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body Modal */}
        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Supported platform tags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
            <span style={{ fontSize: "0.75rem", color: "#94a3b8", fontWeight: 600 }}>Nền tảng hỗ trợ:</span>
            {[
              { name: "Douyin", color: "#ff0050" },
              { name: "TikTok", color: "#00f2fe" },
              { name: "Xiaohongshu", color: "#fe2c55" },
              { name: "Kuaishou", color: "#ff8400" },
              { name: "Bilibili", color: "#23c9ed" },
            ].map((p) => (
              <span
                key={p.name}
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 8px",
                  borderRadius: "20px",
                  background: "rgba(255, 255, 255, 0.05)",
                  border: `1px solid ${p.color}40`,
                  color: "#e2e8f0",
                }}
              >
                {p.name}
              </span>
            ))}
          </div>

          {/* Input text box */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <label style={{ fontSize: "0.82rem", fontWeight: 600, color: "#cbd5e1" }}>
                Dán liên kết hoặc toàn bộ đoạn chia sẻ từ App:
              </label>
              <button
                type="button"
                onClick={handlePasteClipboard}
                style={{
                  background: "rgba(255, 255, 255, 0.08)",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#cbd5e1",
                  borderRadius: "6px",
                  padding: "3px 8px",
                  fontSize: "0.72rem",
                  cursor: "pointer",
                }}
              >
                📋 Dán từ Clipboard
              </button>
            </div>

            <textarea
              rows={3}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ví dụ: 3.89 :4pm ... https://v.douyin.com/fis-hwrfUow/ hoặc https://www.tiktok.com/@user/video/..."
              style={{
                width: "100%",
                background: "rgba(15, 23, 42, 0.8)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                borderRadius: "10px",
                padding: "10px 12px",
                color: "#f8fafc",
                fontSize: "0.85rem",
                fontFamily: "inherit",
                resize: "none",
                outline: "none",
                transition: "border 0.2s ease",
              }}
            />

            <button
              type="button"
              onClick={handleFetchInfo}
              disabled={isLoading || isDownloading || !inputText.trim()}
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #a855f7 100%)",
                border: "none",
                color: "#ffffff",
                padding: "10px 16px",
                borderRadius: "10px",
                fontWeight: 600,
                fontSize: "0.88rem",
                cursor: isLoading || isDownloading ? "not-allowed" : "pointer",
                opacity: isLoading || isDownloading || !inputText.trim() ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                boxShadow: "0 4px 14px rgba(99, 102, 241, 0.3)",
              }}
            >
              {isLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm" style={{ width: "16px", height: "16px" }}></span>
                  Đang phân tích link video...
                </>
              ) : (
                <>
                  <span>🔍</span> Lấy Link Video Không Logo
                </>
              )}
            </button>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "8px",
                color: "#fca5a5",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Success Message */}
          {downloadSuccessMsg && (
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(34, 197, 94, 0.15)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                borderRadius: "8px",
                color: "#86efac",
                fontSize: "0.82rem",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>✅</span>
              <span>{downloadSuccessMsg}</span>
            </div>
          )}

          {/* Result Card */}
          {videoInfo && (() => {
            const effectiveDuration = detectedDuration || videoInfo.duration || 0;
            const proxyCoverUrl = videoInfo.cover_url
              ? `${API_BASE}/api/downloader/proxy-image?url=${encodeURIComponent(videoInfo.cover_url)}`
              : "";
            const currentThumbnail = capturedThumb || (!imgLoadFailed && proxyCoverUrl ? proxyCoverUrl : "");

            return (
              <div
                style={{
                  background: "rgba(30, 41, 59, 0.7)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "12px",
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                }}
              >
                {/* Hidden video element to auto-detect duration and fallback thumbnail */}
                <video
                  ref={hiddenVideoRef}
                  src={videoInfo.video_url}
                  preload="metadata"
                  crossOrigin="anonymous"
                  muted
                  playsInline
                  style={{ display: "none" }}
                  onLoadedMetadata={(e) => {
                    const d = Math.round(e.currentTarget.duration);
                    if (d > 0) {
                      setDetectedDuration((prev) => (prev > 0 ? prev : d));
                    }
                    if (!videoInfo.cover_url || imgLoadFailed) {
                      e.currentTarget.currentTime = Math.min(0.5, d > 1 ? 1.0 : 0.1);
                    }
                  }}
                  onSeeked={(e) => {
                    if (!videoInfo.cover_url || imgLoadFailed) {
                      try {
                        const v = e.currentTarget;
                        if (v.videoWidth > 0 && v.videoHeight > 0) {
                          const canvas = document.createElement("canvas");
                          canvas.width = v.videoWidth;
                          canvas.height = v.videoHeight;
                          const ctx = canvas.getContext("2d");
                          if (ctx) {
                            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                            setCapturedThumb(canvas.toDataURL("image/jpeg", 0.85));
                          }
                        }
                      } catch {
                        // ignore canvas tainted error
                      }
                    }
                  }}
                />

                <div style={{ display: "flex", gap: "14px" }}>
                  {/* Thumbnail Container */}
                  <div
                    style={{
                      position: "relative",
                      width: "92px",
                      height: "124px",
                      borderRadius: "10px",
                      overflow: "hidden",
                      background: "linear-gradient(145deg, #1e293b, #0f172a)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.35)",
                    }}
                  >
                    {currentThumbnail ? (
                      <img
                        src={currentThumbnail}
                        alt="cover"
                        referrerPolicy="no-referrer"
                        crossOrigin="anonymous"
                        onError={() => {
                          setImgLoadFailed(true);
                          if (hiddenVideoRef.current) {
                            hiddenVideoRef.current.currentTime = 0.5;
                          }
                        }}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "4px",
                        }}
                      >
                        <span style={{ fontSize: "1.8rem" }}>🎬</span>
                        <span style={{ fontSize: "0.62rem", color: "#64748b", fontWeight: 600 }}>Video</span>
                      </div>
                    )}

                    {/* Duration badge on thumbnail bottom */}
                    {effectiveDuration > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "5px",
                          right: "5px",
                          background: "rgba(0, 0, 0, 0.8)",
                          color: "#ffffff",
                          fontSize: "0.68rem",
                          fontWeight: 700,
                          padding: "1px 5px",
                          borderRadius: "4px",
                          backdropFilter: "blur(4px)",
                          border: "1px solid rgba(255, 255, 255, 0.15)",
                          display: "flex",
                          alignItems: "center",
                          gap: "3px",
                        }}
                      >
                        {formatDuration(effectiveDuration)}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", minWidth: 0, flex: 1 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                        {(() => {
                          const badge = getPlatformBadge(videoInfo.platform);
                          return (
                            <span
                              style={{
                                background: badge.bg,
                                border: `1px solid ${badge.border}`,
                                color: "#ffffff",
                                fontSize: "0.68rem",
                                fontWeight: 700,
                                padding: "2px 8px",
                                borderRadius: "4px",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              <span>{badge.icon}</span>
                              {badge.label}
                            </span>
                          );
                        })()}
                        {effectiveDuration > 0 && (
                          <span
                            style={{
                              fontSize: "0.72rem",
                              color: "#38bdf8",
                              fontWeight: 600,
                              background: "rgba(56, 189, 248, 0.12)",
                              border: "1px solid rgba(56, 189, 248, 0.25)",
                              padding: "1px 7px",
                              borderRadius: "4px",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "3px",
                            }}
                          >
                            ⏱️ {formatDuration(effectiveDuration)}
                          </span>
                        )}
                      </div>

                      <h4
                        style={{
                          margin: 0,
                          fontSize: "0.88rem",
                          color: "#f8fafc",
                          fontWeight: 600,
                          lineHeight: 1.4,
                          display: "-webkit-box",
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                        title={videoInfo.title}
                      >
                        {videoInfo.title}
                      </h4>
                    </div>

                    <div style={{ fontSize: "0.72rem", color: "#10b981", fontWeight: 600, display: "flex", alignItems: "center", gap: "4px" }}>
                      <span>✨</span> Video HD không logo / watermark
                    </div>
                  </div>
                </div>

              {/* Action Buttons */}
              <div style={{ display: "grid", gridTemplateColumns: onSelectVideoForStudio ? "1fr 1fr" : "1fr", gap: "10px", marginTop: "4px" }}>
                {onSelectVideoForStudio && (
                  <button
                    type="button"
                    onClick={handleDownloadToServer}
                    disabled={isDownloading}
                    style={{
                      background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                      border: "none",
                      color: "#ffffff",
                      padding: "10px 14px",
                      borderRadius: "10px",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: isDownloading ? "not-allowed" : "pointer",
                      opacity: isDownloading ? 0.7 : 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
                    }}
                  >
                    {isDownloading ? (
                      <>
                        <span className="spinner-border spinner-border-sm" style={{ width: "14px", height: "14px" }}></span>
                        Đang nạp video...
                      </>
                    ) : (
                      <>
                        <span>🚀</span> Nhập Vào Studio
                      </>
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleSaveToComputer}
                  disabled={isDownloading}
                  style={{
                    background: "rgba(255, 255, 255, 0.08)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    color: "#f8fafc",
                    padding: "10px 14px",
                    borderRadius: "10px",
                    fontWeight: 600,
                    fontSize: "0.85rem",
                    cursor: isDownloading ? "not-allowed" : "pointer",
                    opacity: isDownloading ? 0.7 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                  }}
                >
                  <span>⬇️</span> Tải Về Máy Tính
                </button>
              </div>
            </div>
          );
        })()}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "rgba(15, 23, 42, 0.6)",
          }}
        >
          <span style={{ fontSize: "0.72rem", color: "#64748b" }}>
            Tự động loại bỏ watermark & nạp video trực tiếp vào Studio
          </span>
          <button
            type="button"
            onClick={onClose}
            disabled={isDownloading}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              color: "#cbd5e1",
              padding: "6px 14px",
              borderRadius: "8px",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
