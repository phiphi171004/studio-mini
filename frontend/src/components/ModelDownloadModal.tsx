"use client";

import React, { useState, useEffect, useRef } from "react";

export interface ModelInfo {
  key: string;
  name: string;
  filename: string;
  size_mb: number;
  description: string;
  downloaded: boolean;
  downloading?: boolean;
  progress?: number;
  speed_mbps?: number;
  error?: string | null;
}

interface ModelDownloadModalProps {
  isOpen: boolean;
  modelKey: "big_lama" | "directml_onnx";
  modelInfo?: ModelInfo;
  onClose: () => void;
  onDownloadComplete: () => void;
}

export const ModelDownloadModal: React.FC<ModelDownloadModalProps> = ({
  isOpen,
  modelKey,
  modelInfo,
  onClose,
  onDownloadComplete,
}) => {
  const [status, setStatus] = useState<"idle" | "downloading" | "completed" | "error">("idle");
  const [progress, setProgress] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(0);
  const [downloadedBytes, setDownloadedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const modelDisplayName = modelKey === "big_lama" ? "Big-LaMa AI (PyTorch CUDA)" : "LaMa AI (DirectML ONNX)";
  const modelSizeMB = modelKey === "big_lama" ? 196 : 197;
  const modelDesc =
    modelKey === "big_lama"
      ? "Mô hình xóa chữ chất lượng cao nhất bằng AI, tối ưu hóa cho card rời NVIDIA."
      : "Mô hình siêu nhẹ qua DirectML ONNX, tiết kiệm 70% VRAM, tối ưu cho GPU yếu hoặc Laptop.";

  useEffect(() => {
    if (isOpen) {
      // Check current progress
      checkProgress();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [isOpen, modelKey]);

  const stopPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const checkProgress = async () => {
    try {
      const res = await fetch(`/api/models/progress/${modelKey}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === "downloading") {
          setStatus("downloading");
          setProgress(data.progress || 0);
          setSpeed(data.speed_mbps || 0);
          setDownloadedBytes(data.downloaded_bytes || 0);
          setTotalBytes(data.total_bytes || 0);
          startPolling();
        } else if (data.status === "completed") {
          setStatus("completed");
          setProgress(100);
        } else if (data.status === "error") {
          setStatus("error");
          setErrorMessage(data.error || "Lỗi tải model.");
        } else {
          setStatus("idle");
          setProgress(0);
        }
      }
    } catch (err) {
      console.warn("Lỗi kiểm tra tiến trình:", err);
    }
  };

  const startPolling = () => {
    if (pollTimerRef.current) return;
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/models/progress/${modelKey}`);
        if (res.ok) {
          const data = await res.json();
          if (data.status === "downloading") {
            setStatus("downloading");
            setProgress(data.progress || 0);
            setSpeed(data.speed_mbps || 0);
            setDownloadedBytes(data.downloaded_bytes || 0);
            setTotalBytes(data.total_bytes || 0);
          } else if (data.status === "completed") {
            setStatus("completed");
            setProgress(100);
            stopPolling();
            setTimeout(() => {
              onDownloadComplete();
            }, 800);
          } else if (data.status === "error") {
            setStatus("error");
            setErrorMessage(data.error || "Lỗi tải model.");
            stopPolling();
          }
        }
      } catch (e) {
        console.warn("Poll error:", e);
      }
    }, 400);
  };

  const handleStartDownload = async () => {
    try {
      setStatus("downloading");
      setProgress(1);
      setErrorMessage("");
      const res = await fetch(`/api/models/download/${modelKey}`, { method: "POST" });
      if (res.ok) {
        startPolling();
      } else {
        const err = await res.json();
        setStatus("error");
        setErrorMessage(err.detail || "Không thể khởi động tải model.");
      }
    } catch (err: any) {
      setStatus("error");
      setErrorMessage(err.message || "Lỗi kết nối server.");
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "480px",
          backgroundColor: "#111827",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.8)",
          color: "#f3f4f6",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#fff" }}>
              📥 Tải Mô Hình AI Xóa Chữ
            </h3>
            <p style={{ margin: "4px 0 0 0", fontSize: "0.82rem", color: "#9ca3af" }}>
              Tải theo yêu cầu để giữ dung lượng app luôn siêu nhẹ
            </p>
          </div>
          {status !== "downloading" && (
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "#9ca3af",
                fontSize: "1.3rem",
                cursor: "pointer",
                padding: "2px 6px",
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Model Card Info */}
        <div
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "#60a5fa" }}>
              {modelKey === "big_lama" ? "🔥 " : "⚡ "}
              {modelDisplayName}
            </span>
            <span
              style={{
                backgroundColor: "rgba(96, 165, 250, 0.15)",
                color: "#93c5fd",
                padding: "2px 8px",
                borderRadius: "12px",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              ~{modelSizeMB} MB
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.4 }}>
            {modelDesc}
          </p>
        </div>

        {/* Progress or Actions */}
        {status === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ fontSize: "0.82rem", color: "#94a3b8" }}>
              Mô hình này chưa có trong máy. Bạn chỉ cần tải một lần duy nhất, app sẽ lưu lại để dùng vĩnh viễn không cần tải lại.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#cbd5e1",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                Để sau
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                  border: "none",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "8px 20px",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(99, 102, 241, 0.35)",
                }}
              >
                📥 Tải Ngay (~{modelSizeMB} MB)
              </button>
            </div>
          </div>
        )}

        {status === "downloading" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.85rem", fontWeight: 600 }}>
              <span style={{ color: "#a5b4fc" }}>Đang tải mô hình...</span>
              <span style={{ color: "#38bdf8" }}>{progress}%</span>
            </div>

            {/* Progress bar container */}
            <div
              style={{
                width: "100%",
                height: "10px",
                backgroundColor: "rgba(255, 255, 255, 0.1)",
                borderRadius: "5px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              <div
                style={{
                  width: `${progress}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, #3b82f6, #10b981)",
                  transition: "width 0.2s ease",
                  borderRadius: "5px",
                }}
              />
            </div>

            {/* Details */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "#94a3b8" }}>
              <span>
                {downloadedBytes > 0 ? (downloadedBytes / (1024 * 1024)).toFixed(1) : 0} MB / ~{modelSizeMB} MB
              </span>
              <span>{speed > 0 ? `${speed} MB/s` : "Đang kết nối..."}</span>
            </div>
          </div>
        )}

        {status === "completed" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "10px 0" }}>
            <div style={{ fontSize: "2.5rem" }}>✅</div>
            <div style={{ fontSize: "1rem", fontWeight: 700, color: "#34d399" }}>
              Tải Mô Hình Thành Công!
            </div>
            <div style={{ fontSize: "0.82rem", color: "#94a3b8", textAlign: "center" }}>
              Mô hình đã sẵn sàng hoạt động ngay lập tức.
            </div>
          </div>
        )}

        {status === "error" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ backgroundColor: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.3)", borderRadius: "8px", padding: "10px", color: "#fca5a5", fontSize: "0.82rem" }}>
              ⚠️ {errorMessage || "Đã xảy ra lỗi khi tải mô hình. Vui lòng kiểm tra kết nối mạng và thử lại."}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "4px" }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: "transparent",
                  border: "1px solid rgba(255, 255, 255, 0.15)",
                  color: "#cbd5e1",
                  borderRadius: "8px",
                  padding: "8px 16px",
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                Đóng
              </button>
              <button
                type="button"
                onClick={handleStartDownload}
                style={{
                  background: "#ef4444",
                  border: "none",
                  color: "#fff",
                  borderRadius: "8px",
                  padding: "8px 20px",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                🔄 Thử Lại
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
