"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";

export interface ManualRemovalRegion {
  id: string;
  name: string;
  x: number; // 0..1 (tỷ lệ chuẩn so với chiều rộng thực của video)
  y: number; // 0..1 (tỷ lệ chuẩn so với chiều cao thực của video)
  w: number; // 0..1
  h: number; // 0..1
  startTime: number; // giây
  endTime: number;   // giây
}

interface ManualRemovalEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoSrc: string | null;
  videoDuration: number;
  regions: ManualRemovalRegion[];
  onSaveRegions: (regions: ManualRemovalRegion[]) => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00.0";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${ms}`;
}

export const ManualRemovalEditorModal: React.FC<ManualRemovalEditorModalProps> = ({
  isOpen,
  onClose,
  videoSrc,
  videoDuration,
  regions,
  onSaveRegions,
}) => {
  const [localRegions, setLocalRegions] = useState<ManualRemovalRegion[]>(regions);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  // Video playback & container bounds
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Video bounds chính xác tuyệt đối (loại trừ dải đen pillarbox/letterbox)
  const [videoBounds, setVideoBounds] = useState<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  const updateVideoBounds = useCallback(() => {
    const vid = videoRef.current;
    const container = containerRef.current;
    if (!vid || !container) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const vw = vid.videoWidth || 1280;
    const vh = vid.videoHeight || 720;
    if (cw <= 0 || ch <= 0 || vw <= 0 || vh <= 0) return;

    const containerAspect = cw / ch;
    const videoAspect = vw / vh;
    let renderW = cw;
    let renderH = ch;
    let left = 0;
    let top = 0;

    if (videoAspect < containerAspect) {
      // Video dạng dọc 9:16 trên màn ngang -> dải đen 2 bên (pillarbox)
      renderH = ch;
      renderW = ch * videoAspect;
      left = (cw - renderW) / 2;
      top = 0;
    } else {
      // Video dạng ngang 16:9 -> dải đen trên dưới (letterbox)
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

  useEffect(() => {
    if (isOpen) {
      setLocalRegions(regions);
      setTimeout(updateVideoBounds, 50);
      setTimeout(updateVideoBounds, 250);
    }
  }, [regions, isOpen, updateVideoBounds]);

  useEffect(() => {
    const handleResize = () => updateVideoBounds();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [updateVideoBounds]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => updateVideoBounds());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [updateVideoBounds]);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [draftBox, setDraftBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  if (!isOpen) return null;

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

  const handleSeek = (time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Bắt đầu vẽ khung trên overlay video chuẩn (tọa độ 1:1 theo video)
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    setIsDrawing(true);
    setDrawStart({ x, y });
    setDraftBox({ x, y, w: 0, h: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !overlayRef.current) return;
    const rect = overlayRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const currentX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const currentY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    const x = Math.min(drawStart.x, currentX);
    const y = Math.min(drawStart.y, currentY);
    const w = Math.abs(currentX - drawStart.x);
    const h = Math.abs(currentY - drawStart.y);

    setDraftBox({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (!isDrawing || !draftBox) return;
    setIsDrawing(false);

    // Bỏ qua nếu vùng vẽ quá nhỏ (< 1.5% chiều rộng/cao)
    if (draftBox.w > 0.015 && draftBox.h > 0.015) {
      const newRegion: ManualRemovalRegion = {
        id: `region_${Date.now()}`,
        name: `Khung ${localRegions.length + 1}`,
        x: draftBox.x,
        y: draftBox.y,
        w: draftBox.w,
        h: draftBox.h,
        startTime: Math.max(0, currentTime - 0.2),
        endTime: Math.min(videoDuration > 0 ? videoDuration : 999, currentTime + 3.0),
      };
      const updated = [...localRegions, newRegion];
      setLocalRegions(updated);
      setSelectedRegionId(newRegion.id);
    }
    setDraftBox(null);
    setDrawStart(null);
  };

  const handleDeleteRegion = (id: string) => {
    const updated = localRegions.filter((r) => r.id !== id);
    setLocalRegions(updated);
    if (selectedRegionId === id) setSelectedRegionId(null);
  };

  const handleUpdateRegionTime = (id: string, start: number, end: number) => {
    setLocalRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, startTime: Math.max(0, start), endTime: Math.max(start + 0.1, end) } : r))
    );
  };

  const handleSave = () => {
    onSaveRegions(localRegions);
    onClose();
  };

  // Lọc các region đang hiển thị tại thời điểm currentTime
  const activeRegionsAtCurrentTime = localRegions.filter(
    (r) => currentTime >= r.startTime && currentTime <= r.endTime
  );

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          backgroundColor: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "1150px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#f8fafc" }}>
              ✂️ Chọn Khung Hình & Khoảng Thời Gian Xóa Phụ Đề
            </h3>
            <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "#94a3b8" }}>
              Kéo chuột trực tiếp trên video để bao quanh toàn bộ dòng chữ. Chỉnh thời gian xuất hiện tương ứng bên phải.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              fontSize: "1.25rem",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Body Content */}
        <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
          {/* Left: Video Preview & Canvas */}
          <div
            style={{
              flex: 1.4,
              backgroundColor: "#020617",
              display: "flex",
              flexDirection: "column",
              padding: "16px",
              borderRight: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            {/* Outer Container with Black Bars */}
            <div
              ref={containerRef}
              style={{
                position: "relative",
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#000",
                borderRadius: "8px",
                overflow: "hidden",
                userSelect: "none",
              }}
            >
              {/* Inner Wrapper khớp 100% với khung hình video thực tế */}
              <div
                style={{
                  position: "absolute",
                  left: `${videoBounds.left}px`,
                  top: `${videoBounds.top}px`,
                  width: `${videoBounds.width > 10 ? videoBounds.width : 300}px`,
                  height: `${videoBounds.height > 10 ? videoBounds.height : 400}px`,
                }}
              >
                {videoSrc && (
                  <video
                    ref={videoRef}
                    src={videoSrc}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={updateVideoBounds}
                    style={{ width: "100%", height: "100%", objectFit: "fill", display: "block" }}
                  />
                )}

                {/* Drawing Overlay - Phủ chuẩn 100% kích thước video */}
                <div
                  ref={overlayRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  style={{
                    position: "absolute",
                    inset: 0,
                    cursor: "crosshair",
                  }}
                >
                  {/* Các khung đã lưu đang active tại currentTime */}
                  {localRegions.map((region) => {
                    const isActive = currentTime >= region.startTime && currentTime <= region.endTime;
                    const isSelected = region.id === selectedRegionId;

                    return (
                      <div
                        key={region.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRegionId(region.id);
                        }}
                        style={{
                          position: "absolute",
                          left: `${region.x * 100}%`,
                          top: `${region.y * 100}%`,
                          width: `${region.w * 100}%`,
                          height: `${region.h * 100}%`,
                          border: isSelected
                            ? "2px solid #ef4444"
                            : isActive
                            ? "2px dashed #f59e0b"
                            : "1px dashed rgba(255, 255, 255, 0.3)",
                          backgroundColor: isSelected
                            ? "rgba(239, 68, 68, 0.3)"
                            : isActive
                            ? "rgba(245, 158, 11, 0.25)"
                            : "rgba(255, 255, 255, 0.05)",
                          boxSizing: "border-box",
                          pointerEvents: "auto",
                          cursor: "pointer",
                        }}
                      >
                        <span
                          style={{
                            position: "absolute",
                            top: "-22px",
                            left: "0",
                            backgroundColor: isSelected ? "#ef4444" : isActive ? "#f59e0b" : "#475569",
                            color: "#fff",
                            fontSize: "0.7rem",
                            fontWeight: 700,
                            padding: "2px 6px",
                            borderRadius: "4px",
                            whiteSpace: "nowrap",
                            boxShadow: "0 2px 4px rgba(0,0,0,0.5)",
                          }}
                        >
                          {region.name} ({formatTime(region.startTime)} - {formatTime(region.endTime)})
                        </span>
                      </div>
                    );
                  })}

                  {/* Draft Box khi đang kéo chuột */}
                  {draftBox && (
                    <div
                      style={{
                        position: "absolute",
                        left: `${draftBox.x * 100}%`,
                        top: `${draftBox.y * 100}%`,
                        width: `${draftBox.w * 100}%`,
                        height: `${draftBox.h * 100}%`,
                        border: "2px dashed #38bdf8",
                        backgroundColor: "rgba(56, 189, 248, 0.25)",
                        boxSizing: "border-box",
                        pointerEvents: "none",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Video Controls & Timeline Slider */}
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  type="button"
                  onClick={togglePlay}
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.1)",
                    border: "1px solid rgba(255, 255, 255, 0.2)",
                    borderRadius: "6px",
                    color: "#fff",
                    padding: "6px 14px",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                  }}
                >
                  {isPlaying ? "⏸ Tạm Dừng" : "▶ Phát"}
                </button>
                <span style={{ fontSize: "0.85rem", color: "#f8fafc", fontFamily: "monospace", fontWeight: 700 }}>
                  {formatTime(currentTime)} / {formatTime(videoDuration)}
                </span>
                <span style={{ fontSize: "0.75rem", color: "#94a3b8", marginLeft: "auto" }}>
                  💡 Kéo thanh trượt để di chuyển đến vị trí chữ xuất hiện
                </span>
              </div>

              <input
                type="range"
                min={0}
                max={videoDuration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: "#ef4444", cursor: "pointer" }}
              />
            </div>
          </div>

          {/* Right: Regions List & Time Settings */}
          <div
            style={{
              flex: 1,
              padding: "16px",
              display: "flex",
              flexDirection: "column",
              backgroundColor: "#0b1329",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#f8fafc" }}>
                📍 Danh sách vùng xóa ({localRegions.length})
              </h4>
              <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                Active hiện tại: {activeRegionsAtCurrentTime.length} vùng
              </span>
            </div>

            {localRegions.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  border: "1px dashed rgba(255, 255, 255, 0.15)",
                  borderRadius: "8px",
                  padding: "24px",
                  textAlign: "center",
                  color: "#64748b",
                }}
              >
                <span style={{ fontSize: "2rem", marginBottom: "8px" }}>✏️</span>
                <p style={{ margin: 0, fontSize: "0.85rem", fontWeight: 600 }}>Chưa có khung xóa nào</p>
                <p style={{ margin: "4px 0 0", fontSize: "0.75rem" }}>
                  Hãy dùng chuột kéo một hình chữ nhật bao quanh toàn bộ dòng chữ trên video.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", flex: 1, overflowY: "auto" }}>
                {localRegions.map((region, idx) => {
                  const isSelected = region.id === selectedRegionId;
                  const isActiveNow = currentTime >= region.startTime && currentTime <= region.endTime;

                  return (
                    <div
                      key={region.id}
                      onClick={() => {
                        setSelectedRegionId(region.id);
                        handleSeek(region.startTime);
                      }}
                      style={{
                        padding: "12px",
                        backgroundColor: isSelected ? "rgba(239, 68, 68, 0.12)" : "rgba(255, 255, 255, 0.03)",
                        border: isSelected ? "1px solid #ef4444" : "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "8px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.85rem", color: isSelected ? "#ef4444" : "#f1f5f9" }}>
                          Khung #{idx + 1}: {region.name}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {isActiveNow && (
                            <span
                              style={{
                                fontSize: "0.65rem",
                                backgroundColor: "#10b981",
                                color: "#fff",
                                padding: "1px 6px",
                                borderRadius: "4px",
                                fontWeight: 700,
                              }}
                            >
                              ĐANG HIỆN
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteRegion(region.id);
                            }}
                            style={{
                              background: "rgba(239, 68, 68, 0.2)",
                              border: "1px solid rgba(239, 68, 68, 0.4)",
                              borderRadius: "4px",
                              color: "#f87171",
                              padding: "2px 6px",
                              fontSize: "0.75rem",
                              cursor: "pointer",
                            }}
                          >
                            🗑️
                          </button>
                        </div>
                      </div>

                      {/* Time Controls */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "0.75rem" }}>
                        <div>
                          <label style={{ display: "block", color: "#94a3b8", marginBottom: "2px" }}>Bắt đầu (giây):</label>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <input
                              type="number"
                              step={0.1}
                              min={0}
                              max={region.endTime - 0.1}
                              value={region.startTime}
                              onChange={(e) => handleUpdateRegionTime(region.id, parseFloat(e.target.value) || 0, region.endTime)}
                              style={{
                                width: "100%",
                                backgroundColor: "#020617",
                                border: "1px solid rgba(255, 255, 255, 0.15)",
                                borderRadius: "4px",
                                color: "#fff",
                                padding: "4px 6px",
                                fontSize: "0.75rem",
                              }}
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateRegionTime(region.id, currentTime, region.endTime);
                              }}
                              title="Lấy thời gian hiện tại của video"
                              style={{
                                backgroundColor: "rgba(255, 255, 255, 0.1)",
                                border: "none",
                                borderRadius: "4px",
                                color: "#fff",
                                padding: "4px 6px",
                                fontSize: "0.65rem",
                                cursor: "pointer",
                              }}
                            >
                              📍Lấy
                            </button>
                          </div>
                        </div>

                        <div>
                          <label style={{ display: "block", color: "#94a3b8", marginBottom: "2px" }}>Kết thúc (giây):</label>
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <input
                              type="number"
                              step={0.1}
                              min={region.startTime + 0.1}
                              max={videoDuration || 9999}
                              value={region.endTime}
                              onChange={(e) => handleUpdateRegionTime(region.id, region.startTime, parseFloat(e.target.value) || region.startTime + 1)}
                              style={{
                                width: "100%",
                                backgroundColor: "#020617",
                                border: "1px solid rgba(255, 255, 255, 0.15)",
                                borderRadius: "4px",
                                color: "#fff",
                                padding: "4px 6px",
                                fontSize: "0.75rem",
                              }}
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleUpdateRegionTime(region.id, region.startTime, currentTime);
                              }}
                              title="Lấy thời gian hiện tại của video"
                              style={{
                                backgroundColor: "rgba(255, 255, 255, 0.1)",
                                border: "none",
                                borderRadius: "4px",
                                color: "#fff",
                                padding: "4px 6px",
                                fontSize: "0.65rem",
                                cursor: "pointer",
                              }}
                            >
                              📍Lấy
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 24px",
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#091024",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "#94a3b8" }}>
            Đã chọn {localRegions.length} khung xóa phụ đề.
          </span>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: "transparent",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: "6px",
                color: "#94a3b8",
                padding: "8px 16px",
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                backgroundColor: "#ef4444",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                fontWeight: 700,
                padding: "8px 20px",
                fontSize: "0.85rem",
                cursor: "pointer",
                boxShadow: "0 0 15px rgba(239, 68, 68, 0.4)",
              }}
            >
              ✓ Áp Dụng Khung Xóa
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
