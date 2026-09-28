"use client";

import React, { useState, useEffect } from "react";
import { API_BASE } from "@/config";

interface CaptionModalProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string | null;
  videoTitle?: string;
  initialTab?: "caption" | "comment";
}

interface CaptionData {
  titles: string[];
  caption: string;
  hashtags: string[];
  full_post: string;
}

export const CaptionModal: React.FC<CaptionModalProps> = ({
  isOpen,
  onClose,
  taskId,
  videoTitle,
  initialTab = "caption",
}) => {
  const [activeTab, setActiveTab] = useState<"caption" | "comment">(initialTab);
  
  // State Tab Caption
  const [style, setStyle] = useState<string>("viral");
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isLoadingCaption, setIsLoadingCaption] = useState<boolean>(false);
  const [captionData, setCaptionData] = useState<CaptionData | null>(null);
  const [selectedTitleIdx, setSelectedTitleIdx] = useState<number>(0);
  const [editableCaption, setEditableCaption] = useState<string>("");

  // State Tab Comment Affiliate
  const [affiliateLink, setAffiliateLink] = useState<string>("");
  const [customCommentPrompt, setCustomCommentPrompt] = useState<string>("");
  const [isLoadingComment, setIsLoadingComment] = useState<boolean>(false);
  const [commentsList, setCommentsList] = useState<string[]>([]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedType, setCopiedType] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  const fetchCaption = async (customStyle?: string) => {
    if (!taskId) return;
    setIsLoadingCaption(true);
    setErrorMsg(null);

    const activeStyle = customStyle || style;

    try {
      const res = await fetch(`${API_BASE}/api/dubbing/${taskId}/caption`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          style: activeStyle,
          custom_instructions: customPrompt.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo bài viết từ AI.");
      }

      const data: CaptionData = await res.json();
      setCaptionData(data);
      setSelectedTitleIdx(0);
      setEditableCaption(data.caption);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Đã xảy ra lỗi khi gọi AI.";
      setErrorMsg(msg);
    } finally {
      setIsLoadingCaption(false);
    }
  };

  const fetchAffiliateComments = async () => {
    if (!taskId) return;
    const trimmedLink = affiliateLink.trim();
    if (!trimmedLink) {
      setErrorMsg("Vui lòng dán link tiếp thị liên kết (Shopee, TikTok Shop, Lazada...) vào ô trên trước khi tạo comment.");
      return;
    }

    setIsLoadingComment(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE}/api/dubbing/${taskId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliate_link: trimmedLink,
          custom_instructions: customCommentPrompt.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo comment từ AI.");
      }

      const data = await res.json();
      setCommentsList(data.comments || []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Đã xảy ra lỗi khi tạo comment.";
      setErrorMsg(msg);
    } finally {
      setIsLoadingComment(false);
    }
  };

  useEffect(() => {
    if (isOpen && taskId) {
      // Chỉ tự động tải caption bài viết, KHÔNG tự động tạo comment affiliate khi chưa có link
      if (activeTab === "caption" && !captionData && !isLoadingCaption) {
        fetchCaption();
      }
    }
  }, [isOpen, taskId, activeTab]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    setCopiedType(type);
    setTimeout(() => setCopiedType(null), 2500);
  };

  const getFullCaptionContent = () => {
    const currentTitle = captionData?.titles?.[selectedTitleIdx] || "";
    const hashtagStr = captionData?.hashtags?.join(" ") || "";
    return `${currentTitle}\n\n${editableCaption}\n\n${hashtagStr}`.trim();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(5, 8, 16, 0.8)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          background: "#0f172a",
          border: activeTab === "caption" ? "1px solid rgba(168, 85, 247, 0.4)" : "1px solid rgba(16, 185, 129, 0.4)",
          borderRadius: "16px",
          boxShadow: activeTab === "caption" 
            ? "0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(168, 85, 247, 0.15)"
            : "0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(16, 185, 129, 0.15)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "92vh",
          overflow: "hidden",
          transition: "border-color 0.2s ease, box-shadow 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with 2 Main Mode Tabs */}
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "linear-gradient(90deg, rgba(99, 102, 241, 0.12), rgba(168, 85, 247, 0.15))",
          }}
        >
          {/* Tabs Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              type="button"
              onClick={() => setActiveTab("caption")}
              style={{
                background: activeTab === "caption" ? "linear-gradient(135deg, #6366f1, #a855f7)" : "rgba(255, 255, 255, 0.06)",
                border: "none",
                color: activeTab === "caption" ? "#ffffff" : "#94a3b8",
                borderRadius: "8px",
                padding: "7px 14px",
                fontSize: "0.85rem",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: activeTab === "caption" ? "0 2px 10px rgba(168, 85, 247, 0.35)" : "none",
              }}
            >
              📝 Bài Viết Fanpage (Caption)
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("comment")}
              style={{
                background: activeTab === "comment" ? "linear-gradient(135deg, #10b981, #06b6d4)" : "rgba(255, 255, 255, 0.06)",
                border: "none",
                color: activeTab === "comment" ? "#ffffff" : "#94a3b8",
                borderRadius: "8px",
                padding: "7px 14px",
                fontSize: "0.85rem",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: activeTab === "comment" ? "0 2px 10px rgba(16, 185, 129, 0.35)" : "none",
              }}
            >
              💬 Bình Luận Ghim Link (Affiliate)
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.06)",
              border: "none",
              color: "#94a3b8",
              borderRadius: "8px",
              width: "30px",
              height: "30px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1rem",
            }}
          >
            ✕
          </button>
        </div>

        {/* TAB 1: CAPTION BÀI VIẾT */}
        {activeTab === "caption" && (
          <>
            {/* Style Selector Tabs */}
            <div
              style={{
                padding: "10px 20px",
                borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
                display: "flex",
                gap: "8px",
                overflowX: "auto",
                background: "rgba(15, 23, 42, 0.6)",
              }}
            >
              {[
                { id: "viral", label: "🔥 Giật tít Viral" },
                { id: "sales", label: "🛍️ Bán Hàng / Review" },
                { id: "story", label: "😂 Hài Hước Cuốn Hút" },
                { id: "reels", label: "⚡ Ngắn Gọn Reels" },
              ].map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => {
                    setStyle(st.id);
                    fetchCaption(st.id);
                  }}
                  style={{
                    background: style === st.id ? "rgba(168, 85, 247, 0.25)" : "rgba(255, 255, 255, 0.04)",
                    border: style === st.id ? "1px solid #a855f7" : "1px solid rgba(255, 255, 255, 0.08)",
                    color: style === st.id ? "#f3e8ff" : "#94a3b8",
                    borderRadius: "8px",
                    padding: "5px 12px",
                    fontSize: "0.8rem",
                    fontWeight: style === st.id ? 700 : 500,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {st.label}
                </button>
              ))}
            </div>

            {/* Content Body */}
            <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "14px" }}>
              {errorMsg && (
                <div style={{ padding: "10px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#fca5a5", fontSize: "0.82rem" }}>
                  ⚠️ {errorMsg}
                </div>
              )}

              {isLoadingCaption ? (
                <div style={{ padding: "50px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", border: "3px solid rgba(168, 85, 247, 0.2)", borderTopColor: "#a855f7", animation: "spin 0.8s linear infinite" }} />
                  <div style={{ color: "#c084fc", fontWeight: 600, fontSize: "0.9rem" }}>
                    ⚡ Gemini đang phân tích kịch bản và sáng tạo bài viết...
                  </div>
                </div>
              ) : captionData ? (
                <>
                  {/* Tiêu đề */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1" }}>
                        🎯 Gợi ý Tiêu Đề Giật Tít:
                      </span>
                      {copiedType === "title" && (
                        <span style={{ fontSize: "0.74rem", color: "#4ade80", fontWeight: 600 }}>✅ Đã copy tiêu đề!</span>
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {captionData.titles.map((t, idx) => (
                        <div
                          key={idx}
                          onClick={() => setSelectedTitleIdx(idx)}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "8px",
                            background: selectedTitleIdx === idx ? "rgba(99, 102, 241, 0.18)" : "rgba(255, 255, 255, 0.03)",
                            border: selectedTitleIdx === idx ? "1px solid #818cf8" : "1px solid rgba(255, 255, 255, 0.06)",
                            color: selectedTitleIdx === idx ? "#e0e7ff" : "#94a3b8",
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            fontWeight: selectedTitleIdx === idx ? 700 : 500,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                          }}
                        >
                          <span>{selectedTitleIdx === idx ? "🔘 " : "⚪ "}{t}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyToClipboard(t, "title");
                            }}
                            style={{ background: "rgba(255, 255, 255, 0.08)", border: "none", borderRadius: "4px", color: "#cbd5e1", padding: "2px 8px", fontSize: "0.72rem", cursor: "pointer" }}
                          >
                            Copy
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Nội dung Caption */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#cbd5e1" }}>
                        📝 Nội Dung Caption Bài Viết:
                      </span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(editableCaption, "caption")}
                        style={{ background: "rgba(255, 255, 255, 0.08)", border: "none", borderRadius: "4px", color: "#cbd5e1", padding: "3px 10px", fontSize: "0.74rem", cursor: "pointer", fontWeight: 600 }}
                      >
                        {copiedType === "caption" ? "✅ Đã Copy!" : "📋 Copy Caption"}
                      </button>
                    </div>
                    <textarea
                      value={editableCaption}
                      onChange={(e) => setEditableCaption(e.target.value)}
                      rows={7}
                      style={{ width: "100%", background: "rgba(10, 15, 29, 0.85)", border: "1px solid rgba(255, 255, 255, 0.12)", borderRadius: "10px", color: "#f8fafc", padding: "10px 12px", fontSize: "0.86rem", lineHeight: 1.5, resize: "vertical", outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                      placeholder="Nội dung bài viết..."
                    />
                  </div>

                  {/* Hashtags */}
                  {captionData.hashtags && captionData.hashtags.length > 0 && (
                    <div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        {captionData.hashtags.map((h, i) => (
                          <span
                            key={i}
                            onClick={() => copyToClipboard(h, `h_${i}`)}
                            style={{ background: "rgba(168, 85, 247, 0.15)", border: "1px solid rgba(168, 85, 247, 0.3)", color: "#d8b4fe", padding: "2px 8px", borderRadius: "12px", fontSize: "0.74rem", cursor: "pointer" }}
                          >
                            {copiedType === `h_${i}` ? "✅ " : ""}{h}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              {/* Tinh chỉnh & Viết lại */}
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Ghi chú thêm: ví dụ 'thêm số Zalo 09...', 'nhấn mạnh quà tặng'..."
                  onKeyDown={(e) => { if (e.key === "Enter") fetchCaption(); }}
                  style={{ flex: 1, background: "rgba(255, 255, 255, 0.05)", border: "1px solid rgba(255, 255, 255, 0.1)", borderRadius: "8px", color: "#e2e8f0", padding: "7px 12px", fontSize: "0.8rem", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={() => fetchCaption()}
                  disabled={isLoadingCaption}
                  style={{ background: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(168, 85, 247, 0.4)", color: "#e9d5ff", borderRadius: "8px", padding: "7px 14px", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  🔄 Viết Lại
                </button>
              </div>
            </div>

            {/* Footer Tab Caption */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(10, 15, 29, 0.95)" }}>
              <div style={{ fontSize: "0.76rem", color: "#64748b" }}>
                {copiedType === "all_caption" ? (
                  <span style={{ color: "#4ade80", fontWeight: 700 }}>🎉 Đã copy toàn bộ bài viết! Dán ngay lên Facebook thôi!</span>
                ) : (
                  "Đăng kèm video để đạt tương tác cao nhất"
                )}
              </div>
              <button
                type="button"
                onClick={() => copyToClipboard(getFullCaptionContent(), "all_caption")}
                disabled={!captionData}
                style={{ background: "linear-gradient(135deg, #6366f1, #a855f7)", border: "none", color: "#ffffff", borderRadius: "8px", padding: "8px 18px", fontSize: "0.84rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px", boxShadow: "0 4px 15px rgba(168, 85, 247, 0.4)" }}
              >
                {copiedType === "all_caption" ? "✅ Đã Sao Chép!" : "📋 Sao Chép Toàn Bộ Bài Đăng"}
              </button>
            </div>
          </>
        )}

        {/* TAB 2: BÌNH LUẬN GHIM LINK TIẾP THỊ */}
        {activeTab === "comment" && (
          <>
            {/* Input Link Bar */}
            <div style={{ padding: "14px 20px", background: "rgba(16, 185, 129, 0.08)", borderBottom: "1px solid rgba(16, 185, 129, 0.2)", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 700, color: "#6ee7b7" }}>
                🔗 Dán Link Tiếp Thị Liên Kết (Shopee, TikTok Shop, Lazada...):
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text"
                  value={affiliateLink}
                  onChange={(e) => setAffiliateLink(e.target.value)}
                  placeholder="https://s.shopee.vn/9zxuT1aBnc..."
                  onKeyDown={(e) => { if (e.key === "Enter") fetchAffiliateComments(); }}
                  style={{ flex: 1, background: "rgba(10, 15, 29, 0.85)", border: "1px solid rgba(16, 185, 129, 0.4)", borderRadius: "8px", color: "#f8fafc", padding: "8px 12px", fontSize: "0.85rem", outline: "none" }}
                />
                <button
                  type="button"
                  onClick={fetchAffiliateComments}
                  disabled={isLoadingComment}
                  style={{ background: "linear-gradient(135deg, #10b981, #06b6d4)", border: "none", color: "#ffffff", borderRadius: "8px", padding: "8px 16px", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 2px 10px rgba(16, 185, 129, 0.3)" }}
                >
                  {isLoadingComment ? "Đang tạo..." : "🚀 Tạo Comment Mới"}
                </button>
              </div>
            </div>

            {/* Comments Body */}
            <div style={{ padding: "16px 20px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "12px" }}>
              {errorMsg && (
                <div style={{ padding: "10px", borderRadius: "8px", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#fca5a5", fontSize: "0.82rem" }}>
                  ⚠️ {errorMsg}
                </div>
              )}

              {isLoadingComment ? (
                <div style={{ padding: "50px 0", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", border: "3px solid rgba(16, 185, 129, 0.2)", borderTopColor: "#10b981", animation: "spin 0.8s linear infinite" }} />
                  <div style={{ color: "#34d399", fontWeight: 600, fontSize: "0.9rem" }}>
                    ⚡ Gemini đang viết các mẫu comment ghim khéo léo kèm link...
                  </div>
                </div>
              ) : commentsList.length > 0 ? (
                <>
                  <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#94a3b8" }}>
                    📌 Chọn đoạn comment bạn ưng ý nhất để ghim lên đầu bài viết:
                  </span>
                  {commentsList.map((cmt, idx) => (
                    <div
                      key={idx}
                      style={{
                        background: "rgba(255, 255, 255, 0.03)",
                        border: "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "10px",
                        padding: "12px 14px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                      }}
                    >
                      <div style={{ color: "#e2e8f0", fontSize: "0.86rem", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                        {cmt}
                      </div>
                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(cmt, `cmt_${idx}`)}
                          style={{
                            background: copiedType === `cmt_${idx}` ? "rgba(16, 185, 129, 0.3)" : "rgba(16, 185, 129, 0.15)",
                            border: "1px solid rgba(16, 185, 129, 0.4)",
                            color: copiedType === `cmt_${idx}` ? "#4ade80" : "#6ee7b7",
                            borderRadius: "6px",
                            padding: "4px 12px",
                            fontSize: "0.76rem",
                            fontWeight: 700,
                            cursor: "pointer",
                          }}
                        >
                          {copiedType === `cmt_${idx}` ? "✅ Đã Sao Chép!" : "📋 Sao Chép Comment Này"}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "50px 20px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                  <div style={{ fontSize: "2.5rem" }}>🔗</div>
                  <h4 style={{ color: "#f8fafc", margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
                    Chưa có liên kết tiếp thị
                  </h4>
                  <p style={{ color: "#94a3b8", fontSize: "0.82rem", maxWidth: "440px", margin: 0, lineHeight: 1.5 }}>
                    Hãy dán link sản phẩm Shopee, TikTok Shop hoặc Lazada vào ô bên trên rồi bấm nút <strong style={{ color: "#34d399" }}>"🚀 Tạo Comment Mới"</strong> để Gemini AI tự động viết các đoạn bình luận ghim khéo léo kèm link nhé!
                  </p>
                </div>
              )}
            </div>

            {/* Footer Tab Comment */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(10, 15, 29, 0.95)" }}>
              <div style={{ fontSize: "0.76rem", color: "#64748b" }}>
                💡 Mẹo: Ghim comment kèm link giúp không bị Facebook bóp reach tương tác!
              </div>
              <button
                type="button"
                onClick={onClose}
                style={{ background: "rgba(255, 255, 255, 0.06)", border: "1px solid rgba(255, 255, 255, 0.1)", color: "#94a3b8", borderRadius: "8px", padding: "6px 14px", fontSize: "0.82rem", cursor: "pointer" }}
              >
                Đóng
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
