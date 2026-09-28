"use client";

import React from "react";

interface HeaderProps {
  activeTab: "dubbing" | "voices" | "subtitle-remover";
  onTabChange: (tab: "dubbing" | "voices" | "subtitle-remover") => void;
  voiceCount: number;
  isBackendConnected: boolean;
  onOpenSettings: () => void;
  onOpenDownloader?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  onTabChange,
  voiceCount,
  isBackendConnected,
  onOpenSettings,
  onOpenDownloader,
}) => {
  return (
    <header className="app-header">
      <div className="header-container">
        <div className="brand">
          <div className="brand-logo">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="22"></line>
            </svg>
          </div>
          <div>
            <h1 className="brand-title">
              Studio Mini <span className="badge-ai">AI DUBBING</span>
            </h1>
            <p className="brand-subtitle">
              Lồng tiếng video tự động & Giữ nguyên nhạc nền gốc
            </p>
          </div>
        </div>

        <nav className="nav-tabs" role="tablist">
          <button
            id="tab-dubbing-btn"
            className={`tab-btn ${activeTab === "dubbing" ? "active" : ""}`}
            onClick={() => onTabChange("dubbing")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="23 7 16 12 23 17 23 7"></polygon>
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
            </svg>
            Studio Lồng Tiếng
          </button>
          <button
            id="tab-voices-btn"
            className={`tab-btn ${activeTab === "voices" ? "active" : ""}`}
            onClick={() => onTabChange("voices")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            </svg>
            Kho Giọng Đọc ({voiceCount})
          </button>
          <button
            id="tab-remover-btn"
            className={`tab-btn ${activeTab === "subtitle-remover" ? "active" : ""}`}
            onClick={() => onTabChange("subtitle-remover")}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="6" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
              <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
              <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
            </svg>
            Xóa Phụ Đề Video
          </button>
        </nav>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div className={`api-status-pill ${isBackendConnected ? "" : "offline"}`}>
            <span className={`status-dot ${isBackendConnected ? "online" : "offline"}`}></span>
            <span className="status-text">
              {isBackendConnected ? "Backend Connected" : "Backend Offline"}
            </span>
          </div>

          {onOpenDownloader && (
            <button
              id="open-downloader-btn"
              type="button"
              onClick={onOpenDownloader}
              title="Tải video không logo từ Douyin, TikTok, Xiaohongshu, Kuaishou, Bilibili"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                background: "linear-gradient(135deg, rgba(236, 72, 153, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%)",
                border: "1px solid rgba(236, 72, 153, 0.4)",
                color: "#f472b6",
                padding: "7px 12px",
                borderRadius: "10px",
                cursor: "pointer",
                fontSize: "0.85rem",
                fontWeight: 600,
                transition: "all 0.2s ease"
              }}
            >
              <span>📥</span>
              <span>Tải Video MXH</span>
            </button>
          )}

          <button
            id="open-settings-modal-btn"
            type="button"
            onClick={onOpenSettings}
            title="Cài đặt API Dịch Thuật & Phụ Đề"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: "rgba(255, 255, 255, 0.07)",
              border: "1px solid rgba(255, 255, 255, 0.14)",
              color: "#f8fafc",
              padding: "7px 12px",
              borderRadius: "10px",
              cursor: "pointer",
              fontSize: "0.85rem",
              fontWeight: 600,
              transition: "all 0.2s ease"
            }}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
            <span>Cài Đặt</span>
          </button>
        </div>
      </div>
    </header>
  );
};
