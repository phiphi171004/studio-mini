"use client";

import React, { useState, useEffect } from "react";
import { API_BASE } from "@/config";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  // Google Gemini Translation State
  const [geminiApiKey, setGeminiApiKey] = useState<string>("");
  const [geminiModel, setGeminiModel] = useState<string>("gemini-3.5-flash-lite");
  const [showGeminiApiKey, setShowGeminiApiKey] = useState<boolean>(false);
  const [isTestingGemini, setIsTestingGemini] = useState<boolean>(false);
  const [testGeminiResult, setTestGeminiResult] = useState<string | null>(null);

  // Groq STT State
  const [groqApiKey, setGroqApiKey] = useState<string>("");
  const [showGroqApiKey, setShowGroqApiKey] = useState<boolean>(false);

  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Load current settings from backend & localStorage
  useEffect(() => {
    if (!isOpen) return;

    const cachedGemini = typeof window !== "undefined" ? localStorage.getItem("studio_mini_gemini_key") : null;
    const cachedGroq = typeof window !== "undefined" ? localStorage.getItem("studio_mini_groq_key") : null;
    if (cachedGemini) setGeminiApiKey(cachedGemini);
    if (cachedGroq) setGroqApiKey(cachedGroq);

    fetch(`${API_BASE}/api/settings/ai`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) {
          if (data.gemini_model) setGeminiModel(data.gemini_model);
          if (data.has_gemini_key && !cachedGemini && data.masked_gemini_key) {
            setGeminiApiKey(data.masked_gemini_key);
          } else if (data.has_key && !cachedGemini && data.masked_key) {
            setGeminiApiKey(data.masked_key);
          }
          if (data.has_groq_key && !cachedGroq && data.masked_groq_key) {
            setGroqApiKey(data.masked_groq_key);
          }
        }
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const handleTestGemini = async () => {
    if (!geminiApiKey) {
      alert("Vui lòng nhập Google Gemini API Key để kiểm tra.");
      return;
    }
    setIsTestingGemini(true);
    setTestGeminiResult(null);
    try {
      const fd = new FormData();
      fd.append("api_key", geminiApiKey);
      fd.append("gemini_api_key", geminiApiKey);
      fd.append("gemini_model", geminiModel);
      fd.append("model", geminiModel);

      const res = await fetch(`${API_BASE}/api/settings/ai/test`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || "Kiểm tra thất bại.");
      }
      const transStr = Array.isArray(data.translation) ? data.translation.join(" ➔ ") : data.translation;
      setTestGeminiResult(`✅ Kết nối thành công! Dịch SRT mẫu chuẩn ngữ cảnh: "${transStr}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi kết nối Gemini";
      setTestGeminiResult(`❌ ${msg}`);
    } finally {
      setIsTestingGemini(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      fd.append("api_key", geminiApiKey);
      fd.append("gemini_api_key", geminiApiKey);
      fd.append("gemini_model", geminiModel);
      fd.append("model", geminiModel);
      fd.append("groq_api_key", groqApiKey);

      const res = await fetch(`${API_BASE}/api/settings/ai`, {
        method: "POST",
        body: fd,
      });

      if (res.ok) {
        if (typeof window !== "undefined") {
          if (geminiApiKey && !geminiApiKey.includes("...")) {
            localStorage.setItem("studio_mini_gemini_key", geminiApiKey);
            localStorage.setItem("studio_mini_ai_key", geminiApiKey);
          }
          if (groqApiKey && !groqApiKey.includes("...")) {
            localStorage.setItem("studio_mini_groq_key", groqApiKey);
          }
        }
        setSaveMessage("Đã lưu cấu hình Google Gemini vĩnh viễn vào hệ thống!");
        setTimeout(() => {
          setSaveMessage(null);
          onClose();
        }, 1200);
      } else {
        alert("Không thể lưu cấu hình.");
      }
    } catch {
      alert("Lỗi khi lưu cấu hình.");
    }
  };

  return (
    <div
      className="modal-backdrop"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        background: "rgba(3, 7, 18, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        zIndex: 999,
        padding: "20px",
        overflowY: "auto"
      }}
      onClick={onClose}
    >
      <div
        className="modal-content glass-card"
        style={{
          width: "100%",
          maxWidth: "580px",
          background: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: "16px",
          padding: "24px",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.6)",
          position: "relative",
          margin: "auto"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "#f8fafc" }}>
                Cấu Hình AI Dịch Thuật & Phụ Đề
              </h3>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "#94a3b8" }}>
                Dịch SRT toàn diện bằng Google Gemini & Bóc tách giọng bằng Groq
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "#94a3b8",
              cursor: "pointer",
              fontSize: "1.2rem",
              padding: "4px 8px"
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Section 1: Google Gemini Translation */}
          <div style={{
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            padding: "14px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
              <span style={{ fontSize: "1rem" }}>🌐</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#60a5fa" }}>
                1. AI Dịch Thuật SRT Toàn Diện (Google Gemini)
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div>
                <label className="input-label" style={{ fontSize: "0.8rem", display: "flex", justifyContent: "space-between" }}>
                  <span>Gemini API Key (AI Studio)</span>
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#818cf8", fontSize: "0.75rem", textDecoration: "underline" }}
                  >
                    Lấy Key Free tại aistudio.google.com ↗
                  </a>
                </label>
                <div style={{ position: "relative", width: "100%", marginTop: "4px" }}>
                  <input
                    type={showGeminiApiKey ? "text" : "password"}
                    className="custom-select"
                    placeholder="Dán Gemini API Key"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    style={{ width: "100%", paddingRight: "40px" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiApiKey(!showGeminiApiKey)}
                    title={showGeminiApiKey ? "Ẩn Key" : "Hiện Key"}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: showGeminiApiKey ? "#818cf8" : "#94a3b8",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}
                  >
                    {showGeminiApiKey ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                        <circle cx="12" cy="12" r="3"></circle>
                      </svg>
                    )}
                  </button>
                </div>
                <p style={{ margin: "6px 0 0 0", fontSize: "0.74rem", color: "#94a3b8" }}>
                  * Cơ chế gửi nguyên file SRT giúp Gemini hiểu trọn vẹn ngữ cảnh sản phẩm từ đầu đến cuối, chống triệt để lỗi gọi đồ vật là &quot;anh/chị&quot; và chuẩn nhịp theo từng giây.
                </p>
              </div>

              <div>
                <label className="input-label" style={{ fontSize: "0.8rem" }}>Gemini Model</label>
                <input
                  type="text"
                  className="custom-select"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  placeholder="gemini-3.5-flash-lite, gemini-2.0-flash..."
                  style={{ width: "100%", marginTop: "4px" }}
                />
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "6px 12px", fontSize: "0.8rem", alignSelf: "flex-start", marginTop: "2px" }}
                onClick={handleTestGemini}
                disabled={isTestingGemini}
              >
                {isTestingGemini ? "⏳ Đang dịch thử..." : "🧪 Thử dịch SRT mẫu (Gemini)"}
              </button>

              {testGeminiResult && (
                <div style={{
                  fontSize: "0.8rem",
                  padding: "8px 10px",
                  borderRadius: "6px",
                  background: testGeminiResult.startsWith("✅") ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                  color: testGeminiResult.startsWith("✅") ? "#34d399" : "#f87171"
                }}>
                  {testGeminiResult}
                </div>
              )}
            </div>
          </div>

          {/* Section 2: Groq Cloud Whisper STT */}
          <div style={{
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "12px",
            padding: "14px"
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
              <span style={{ fontSize: "1rem" }}>⚡</span>
              <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "#34d399" }}>
                2. Bóc Tách Phụ Đề SRT Siêu Tốc (Groq Whisper Large-v3)
              </span>
            </div>

            <div>
              <label className="input-label" style={{ fontSize: "0.8rem", display: "flex", justifyContent: "space-between" }}>
                <span>Groq API Key (gsk_...)</span>
                <a
                  href="https://console.groq.com/keys"
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#38bdf8", fontSize: "0.75rem", textDecoration: "underline" }}
                >
                  Lấy Key Free tại console.groq.com ↗
                </a>
              </label>
              <div style={{ position: "relative", width: "100%", marginTop: "4px" }}>
                <input
                  type={showGroqApiKey ? "text" : "password"}
                  className="custom-select"
                  placeholder="Dán Groq Key (gsk_...) - để trống sẽ tự dùng Whisper trên máy"
                  value={groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  style={{ width: "100%", paddingRight: "40px" }}
                />
                <button
                  type="button"
                  onClick={() => setShowGroqApiKey(!showGroqApiKey)}
                  title={showGroqApiKey ? "Ẩn Key" : "Hiện Key"}
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "50%",
                    transform: "translateY(-50%)",
                    background: "transparent",
                    border: "none",
                    color: showGroqApiKey ? "#34d399" : "#94a3b8",
                    cursor: "pointer",
                    padding: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  {showGroqApiKey ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                      <line x1="1" y1="1" x2="23" y2="23"></line>
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                      <circle cx="12" cy="12" r="3"></circle>
                    </svg>
                  )}
                </button>
              </div>
              <p style={{ margin: "6px 0 0 0", fontSize: "0.74rem", color: "#64748b" }}>
                * Whisper Large-v3-Turbo xử lý bóc tách toàn bộ phụ đề chỉ trong 2 giây với độ chính xác cao.
              </p>
            </div>
          </div>

          {/* Success Feedback */}
          {saveMessage && (
            <div style={{ textAlign: "center", color: "#34d399", fontSize: "0.85rem", fontWeight: 600 }}>
              {saveMessage}
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "8px" }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Đóng
            </button>
            <button type="submit" className="btn btn-primary btn-glow">
              💾 Lưu Cấu Hình Vào Máy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
