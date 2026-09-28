"use client";

import React, { useState } from "react";

export interface InplaceOverlayStyle {
  presetId?: string;
  fontSize: number;          // 22 -> 48
  textColor: string;         // Hex hoặc tên màu
  strokeColor: string;       // Hex viền chữ
  strokeWidth: number;       // 0 -> 4
  boxColor: string;          // Hex màu nền khung
  boxOpacity: number;        // 0.0 -> 1.0
  bold: boolean;
}

export const DEFAULT_INPLACE_STYLE: InplaceOverlayStyle = {
  presetId: "box_black_yellow",
  fontSize: 32,
  textColor: "#FFE600",
  strokeColor: "#000000",
  strokeWidth: 2,
  boxColor: "#000000",
  boxOpacity: 1.0,
  bold: true,
};

interface PresetItem {
  id: string;
  name: string;
  style: InplaceOverlayStyle;
  // CSS preview cho nút chọn Aa
  boxBg: string;
  textColor: string;
  textShadow?: string;
  border?: string;
}

const PRESET_LIST: PresetItem[] = [
  // Hàng 1: Chữ viền / bóng nổi
  {
    id: "text_white_black",
    name: "Trắng viền đen",
    style: {
      presetId: "text_white_black",
      fontSize: 32,
      textColor: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 3,
      boxColor: "#000000",
      boxOpacity: 0.75,
      bold: true,
    },
    boxBg: "#222630",
    textColor: "#FFFFFF",
    textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px #000",
  },
  {
    id: "text_yellow_black",
    name: "Vàng viền đen",
    style: {
      presetId: "text_yellow_black",
      fontSize: 32,
      textColor: "#FFE600",
      strokeColor: "#000000",
      strokeWidth: 3,
      boxColor: "#000000",
      boxOpacity: 0.75,
      bold: true,
    },
    boxBg: "#222630",
    textColor: "#FFE600",
    textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 2px 4px #000",
  },
  {
    id: "text_red_white",
    name: "Đỏ viền trắng",
    style: {
      presetId: "text_red_white",
      fontSize: 32,
      textColor: "#EF4444",
      strokeColor: "#FFFFFF",
      strokeWidth: 2,
      boxColor: "#000000",
      boxOpacity: 0.75,
      bold: true,
    },
    boxBg: "#222630",
    textColor: "#EF4444",
    textShadow: "-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff",
  },
  {
    id: "text_orange_white",
    name: "Cam viền trắng",
    style: {
      presetId: "text_orange_white",
      fontSize: 32,
      textColor: "#F97316",
      strokeColor: "#FFFFFF",
      strokeWidth: 2,
      boxColor: "#000000",
      boxOpacity: 0.75,
      bold: true,
    },
    boxBg: "#222630",
    textColor: "#F97316",
    textShadow: "-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff",
  },
  {
    id: "text_blue_white",
    name: "Xanh viền trắng",
    style: {
      presetId: "text_blue_white",
      fontSize: 32,
      textColor: "#0EA5E9",
      strokeColor: "#FFFFFF",
      strokeWidth: 2,
      boxColor: "#000000",
      boxOpacity: 0.75,
      bold: true,
    },
    boxBg: "#222630",
    textColor: "#0EA5E9",
    textShadow: "-1px -1px 0 #fff, 1px -1px 0 #fff, -1px 1px 0 #fff, 1px 1px 0 #fff",
  },
  {
    id: "text_green_black",
    name: "Xanh lá viền đen",
    style: {
      presetId: "text_green_black",
      fontSize: 32,
      textColor: "#22C55E",
      strokeColor: "#000000",
      strokeWidth: 2,
      boxColor: "#000000",
      boxOpacity: 0.75,
      bold: true,
    },
    boxBg: "#222630",
    textColor: "#22C55E",
    textShadow: "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000",
  },

  // Hàng 2: Hộp nền màu sắc (Box Background - Phong cách TikTok/Douyin)
  {
    id: "box_black_yellow",
    name: "Hộp đen chữ vàng (Mặc định)",
    style: {
      presetId: "box_black_yellow",
      fontSize: 32,
      textColor: "#FFE600",
      strokeColor: "#000000",
      strokeWidth: 2,
      boxColor: "#000000",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#000000",
    textColor: "#FFE600",
    border: "1px solid #FFE600",
  },
  {
    id: "box_yellow_black",
    name: "Hộp vàng chữ đen (Bán hàng)",
    style: {
      presetId: "box_yellow_black",
      fontSize: 32,
      textColor: "#000000",
      strokeColor: "#000000",
      strokeWidth: 0,
      boxColor: "#FFD600",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#FFD600",
    textColor: "#000000",
  },
  {
    id: "box_white_purple",
    name: "Hộp tím chữ trắng",
    style: {
      presetId: "box_white_purple",
      fontSize: 32,
      textColor: "#FFFFFF",
      strokeColor: "#581C87",
      strokeWidth: 1,
      boxColor: "#7E22CE",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#7E22CE",
    textColor: "#FFFFFF",
  },
  {
    id: "box_purple_white",
    name: "Hộp trắng chữ tím",
    style: {
      presetId: "box_purple_white",
      fontSize: 32,
      textColor: "#7E22CE",
      strokeColor: "#7E22CE",
      strokeWidth: 0,
      boxColor: "#FFFFFF",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#FFFFFF",
    textColor: "#7E22CE",
  },
  {
    id: "box_black_white",
    name: "Hộp trắng chữ đen",
    style: {
      presetId: "box_black_white",
      fontSize: 32,
      textColor: "#000000",
      strokeColor: "#000000",
      strokeWidth: 0,
      boxColor: "#FFFFFF",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#FFFFFF",
    textColor: "#000000",
  },
  {
    id: "box_white_black",
    name: "Hộp đen chữ trắng",
    style: {
      presetId: "box_white_black",
      fontSize: 32,
      textColor: "#FFFFFF",
      strokeColor: "#000000",
      strokeWidth: 1,
      boxColor: "#000000",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#000000",
    textColor: "#FFFFFF",
    border: "1px solid #ffffff40",
  },
  {
    id: "box_white_red",
    name: "Hộp đỏ chữ trắng",
    style: {
      presetId: "box_white_red",
      fontSize: 32,
      textColor: "#FFFFFF",
      strokeColor: "#7F1D1D",
      strokeWidth: 1,
      boxColor: "#DC2626",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#DC2626",
    textColor: "#FFFFFF",
  },
  {
    id: "box_green_black",
    name: "Hộp đen chữ xanh",
    style: {
      presetId: "box_green_black",
      fontSize: 32,
      textColor: "#22C55E",
      strokeColor: "#000000",
      strokeWidth: 1,
      boxColor: "#000000",
      boxOpacity: 1.0,
      bold: true,
    },
    boxBg: "#000000",
    textColor: "#22C55E",
    border: "1px solid #22c55e60",
  },
  {
    id: "glow_yellow",
    name: "Chữ vàng phát sáng",
    style: {
      presetId: "glow_yellow",
      fontSize: 32,
      textColor: "#FEF08A",
      strokeColor: "#EAB308",
      strokeWidth: 3,
      boxColor: "#000000",
      boxOpacity: 0.85,
      bold: true,
    },
    boxBg: "#111827",
    textColor: "#FEF08A",
    textShadow: "0 0 8px #EAB308, 0 0 16px #EAB308",
  },
  {
    id: "glow_pink",
    name: "Chữ hồng phát sáng",
    style: {
      presetId: "glow_pink",
      fontSize: 32,
      textColor: "#FCE7F3",
      strokeColor: "#EC4899",
      strokeWidth: 3,
      boxColor: "#000000",
      boxOpacity: 0.85,
      bold: true,
    },
    boxBg: "#111827",
    textColor: "#FCE7F3",
    textShadow: "0 0 8px #EC4899, 0 0 16px #EC4899",
  },
];

const COMMON_TEXT_COLORS = [
  { label: "Vàng", val: "#FFE600" },
  { label: "Trắng", val: "#FFFFFF" },
  { label: "Đen", val: "#000000" },
  { label: "Đỏ", val: "#EF4444" },
  { label: "Cam", val: "#F97316" },
  { label: "Xanh lá", val: "#22C55E" },
  { label: "Xanh dương", val: "#0EA5E9" },
  { label: "Tím", val: "#A855F7" },
  { label: "Hồng", val: "#EC4899" },
];

const COMMON_BOX_COLORS = [
  { label: "Đen", val: "#000000" },
  { label: "Vàng", val: "#FFD600" },
  { label: "Trắng", val: "#FFFFFF" },
  { label: "Tím", val: "#7E22CE" },
  { label: "Đỏ", val: "#DC2626" },
  { label: "Xanh lá", val: "#16A34A" },
  { label: "Xanh dương", val: "#2563EB" },
  { label: "Xám tối", val: "#1F2937" },
];

interface InplaceStyleModalProps {
  isOpen: boolean;
  onClose: () => void;
  style: InplaceOverlayStyle;
  onChangeStyle: (newStyle: InplaceOverlayStyle) => void;
}

export const InplaceStyleModal: React.FC<InplaceStyleModalProps> = ({
  isOpen,
  onClose,
  style,
  onChangeStyle,
}) => {
  const [activeTab, setActiveTab] = useState<"preset" | "custom">("preset");

  if (!isOpen) return null;

  // Tính text shadow CSS cho chữ preview
  const getPreviewTextShadow = () => {
    if (style.strokeWidth === 0) return "none";
    const sc = style.strokeColor;
    const w = style.strokeWidth;
    return `-${w}px -${w}px 0 ${sc}, ${w}px -${w}px 0 ${sc}, -${w}px ${w}px 0 ${sc}, ${w}px ${w}px 0 ${sc}, 0 2px 8px rgba(0,0,0,0.8)`;
  };

  // Tính màu nền preview với opacity
  const getPreviewBoxBackground = () => {
    if (style.boxOpacity <= 0.05) return "transparent";
    // Convert hex sang rgba
    const h = style.boxColor.replace("#", "");
    if (h.length === 6) {
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${style.boxOpacity})`;
    }
    return style.boxColor;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
      }}
      onClick={onClose}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "680px",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#111827",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: "16px",
          padding: "20px 24px",
          boxShadow: "0 20px 50px rgba(0, 0, 0, 0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <div>
            <h3 style={{ fontSize: "1.1rem", fontWeight: 700, color: "#f8fafc", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
              <span>🎨</span> Tùy Chỉnh Kiểu Đè Phụ Đề (CapCut Style)
            </h3>
            <p style={{ fontSize: "0.78rem", color: "#94a3b8", margin: "4px 0 0 0" }}>
              Chọn mẫu có sẵn hoặc tùy chỉnh cỡ chữ, màu sắc và hộp nền ôm khít chữ
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "rgba(255, 255, 255, 0.08)",
              border: "none",
              color: "#94a3b8",
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              fontSize: "1rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* ── 1. Khung Xem Trước Trực Tiếp (Live Preview) ── */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "0.76rem", fontWeight: 600, color: "#cbd5e1", marginBottom: "6px" }}>
            📺 XEM TRƯỚC HIỂN THỊ TRÊN VIDEO:
          </div>
          <div
            style={{
              height: "120px",
              background: "radial-gradient(circle, #1e293b 0%, #090d16 100%)",
              borderRadius: "10px",
              border: "1px solid rgba(255, 255, 255, 0.12)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Lưới giả lập video background */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
                pointerEvents: "none",
              }}
            />

            {/* Hộp phụ đề mẫu hiển thị theo style */}
            <div
              style={{
                background: getPreviewBoxBackground(),
                padding: "6px 20px",
                borderRadius: `${Math.max(8, Math.round(style.fontSize * 0.32))}px`,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                maxWidth: "88%",
                boxShadow: style.boxOpacity > 0 ? "0 4px 14px rgba(0,0,0,0.5)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              <span
                style={{
                  fontFamily: "Arial, sans-serif",
                  fontSize: `${style.fontSize * 0.72}px`, // Thu nhỏ tỷ lệ hiển thị vừa khung preview
                  fontWeight: style.bold ? 700 : 500,
                  color: style.textColor,
                  textShadow: getPreviewTextShadow(),
                  whiteSpace: "nowrap",
                  letterSpacing: "0.5px",
                }}
              >
                Mặt 3D nâng cấp mới
              </span>
            </div>
          </div>
        </div>

        {/* ── 2. Tabs: Kiểu Có Sẵn (Presets) vs Tùy Chỉnh Chi Tiết ── */}
        <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid rgba(255, 255, 255, 0.1)", paddingBottom: "10px", marginBottom: "16px" }}>
          <button
            type="button"
            onClick={() => setActiveTab("preset")}
            style={{
              background: activeTab === "preset" ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "transparent",
              color: activeTab === "preset" ? "#fff" : "#94a3b8",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "0.82rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ⚡ Kiểu Mặc Định (CapCut)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            style={{
              background: activeTab === "custom" ? "linear-gradient(135deg, #6366f1, #8b5cf6)" : "transparent",
              color: activeTab === "custom" ? "#fff" : "#94a3b8",
              border: "none",
              borderRadius: "6px",
              padding: "6px 14px",
              fontSize: "0.82rem",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            🛠️ Tinh Chỉnh Riêng
          </button>
        </div>

        {/* TAB 1: PRESET STYLES NHANH (GIỐNG CAPCUT) */}
        {activeTab === "preset" && (
          <div>
            <div style={{ fontSize: "0.76rem", color: "#94a3b8", marginBottom: "10px" }}>
              Bấm chọn 1 kiểu để áp dụng ngay màu chữ, viền và khung nền:
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                gap: "10px",
                marginBottom: "20px",
              }}
            >
              {PRESET_LIST.map((p) => {
                const isSelected = style.presetId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onChangeStyle({
                        ...p.style,
                        fontSize: style.fontSize, // Giữ nguyên cỡ chữ người dùng đã chọn
                      });
                    }}
                    style={{
                      background: p.boxBg,
                      border: isSelected ? "2px solid #00f2fe" : p.border || "1px solid rgba(255, 255, 255, 0.15)",
                      borderRadius: "10px",
                      height: "64px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: "pointer",
                      padding: "4px",
                      position: "relative",
                      transition: "transform 0.15s ease, border-color 0.15s ease",
                      boxShadow: isSelected ? "0 0 12px rgba(0, 242, 254, 0.5)" : "none",
                      transform: isSelected ? "scale(1.05)" : "scale(1)",
                    }}
                    title={p.name}
                  >
                    <span
                      style={{
                        fontFamily: "Arial, sans-serif",
                        fontSize: "1.35rem",
                        fontWeight: 900,
                        color: p.textColor,
                        textShadow: p.textShadow || "none",
                        lineHeight: 1,
                      }}
                    >
                      Aa
                    </span>
                    {isSelected && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: "2px",
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          background: "#00f2fe",
                        }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Quick Font Size Adjuster inside preset tab */}
            <div style={{ background: "rgba(255, 255, 255, 0.04)", padding: "12px 16px", borderRadius: "10px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1" }}>
                  📏 Cỡ Chữ Phụ Đề: <strong style={{ color: "#38bdf8" }}>{style.fontSize}px</strong>
                </span>
                <div style={{ display: "flex", gap: "6px" }}>
                  {[26, 32, 38, 44].map((sz) => (
                    <button
                      key={sz}
                      type="button"
                      onClick={() => onChangeStyle({ ...style, fontSize: sz })}
                      style={{
                        background: style.fontSize === sz ? "#6366f1" : "rgba(255, 255, 255, 0.08)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "5px",
                        padding: "2px 8px",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                        fontWeight: 600,
                      }}
                    >
                      {sz === 26 ? "Nhỏ" : sz === 32 ? "Chuẩn" : sz === 38 ? "To" : "Cực đại"} ({sz})
                    </button>
                  ))}
                </div>
              </div>
              <input
                type="range"
                min="22"
                max="48"
                step="1"
                value={style.fontSize}
                onChange={(e) => onChangeStyle({ ...style, fontSize: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#6366f1", cursor: "pointer" }}
              />
            </div>
          </div>
        )}

        {/* TAB 2: TÙY CHỈNH CHI TIẾT TỪNG PHẦN */}
        {activeTab === "custom" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* 1. Cỡ chữ */}
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1" }}>1. Cỡ chữ (Font size)</label>
                <span style={{ fontSize: "0.8rem", color: "#38bdf8", fontWeight: 700 }}>{style.fontSize}px</span>
              </div>
              <input
                type="range"
                min="20"
                max="60"
                step="1"
                value={style.fontSize}
                onChange={(e) => onChangeStyle({ ...style, fontSize: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#6366f1", cursor: "pointer" }}
              />
            </div>

            {/* 2. Màu chữ */}
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1" }}>2. Màu chữ</label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="color"
                    value={style.textColor.startsWith("#") ? style.textColor : "#FFE600"}
                    onChange={(e) => onChangeStyle({ ...style, textColor: e.target.value, presetId: undefined })}
                    style={{ width: "24px", height: "24px", borderRadius: "4px", border: "none", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#94a3b8" }}>{style.textColor}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {COMMON_TEXT_COLORS.map((c) => (
                  <button
                    key={c.val}
                    type="button"
                    onClick={() => onChangeStyle({ ...style, textColor: c.val, presetId: undefined })}
                    style={{
                      background: c.val,
                      width: "28px",
                      height: "28px",
                      borderRadius: "6px",
                      border: style.textColor.toLowerCase() === c.val.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.2)",
                      cursor: "pointer",
                      boxShadow: style.textColor.toLowerCase() === c.val.toLowerCase() ? "0 0 8px #38bdf8" : "none",
                    }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* 3. Màu nền khung (Box background) & Độ mờ đục */}
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1" }}>3. Màu nền khung đè</label>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    type="color"
                    value={style.boxColor.startsWith("#") ? style.boxColor : "#000000"}
                    onChange={(e) => onChangeStyle({ ...style, boxColor: e.target.value, presetId: undefined })}
                    style={{ width: "24px", height: "24px", borderRadius: "4px", border: "none", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "#94a3b8" }}>{style.boxColor}</span>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
                {COMMON_BOX_COLORS.map((c) => (
                  <button
                    key={c.val}
                    type="button"
                    onClick={() => onChangeStyle({ ...style, boxColor: c.val, presetId: undefined })}
                    style={{
                      background: c.val,
                      width: "28px",
                      height: "28px",
                      borderRadius: "6px",
                      border: style.boxColor.toLowerCase() === c.val.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.2)",
                      cursor: "pointer",
                      boxShadow: style.boxColor.toLowerCase() === c.val.toLowerCase() ? "0 0 8px #38bdf8" : "none",
                    }}
                    title={c.label}
                  />
                ))}
              </div>

              {/* Slider Opacity */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <span style={{ fontSize: "0.74rem", color: "#94a3b8" }}>Độ đậm nền (Opacity):</span>
                <span style={{ fontSize: "0.74rem", fontWeight: 700, color: "#38bdf8" }}>{Math.round(style.boxOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={style.boxOpacity}
                onChange={(e) => onChangeStyle({ ...style, boxOpacity: Number(e.target.value), presetId: undefined })}
                style={{ width: "100%", accentColor: "#6366f1", cursor: "pointer" }}
              />
            </div>

            {/* 4. Viền chữ (Stroke) */}
            <div style={{ background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <label style={{ fontSize: "0.8rem", fontWeight: 600, color: "#cbd5e1" }}>4. Viền chữ (Stroke/Border)</label>
                <div style={{ display: "flex", gap: "6px" }}>
                  {[0, 1, 2, 3, 4].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => onChangeStyle({ ...style, strokeWidth: w, presetId: undefined })}
                      style={{
                        background: style.strokeWidth === w ? "#6366f1" : "rgba(255, 255, 255, 0.08)",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        padding: "2px 8px",
                        fontSize: "0.72rem",
                        cursor: "pointer",
                      }}
                    >
                      {w === 0 ? "Không" : `${w}px`}
                    </button>
                  ))}
                </div>
              </div>

              {style.strokeWidth > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                  <span style={{ fontSize: "0.74rem", color: "#94a3b8" }}>Màu viền chữ:</span>
                  {["#000000", "#FFFFFF", "#7E22CE", "#EF4444"].map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => onChangeStyle({ ...style, strokeColor: sc, presetId: undefined })}
                      style={{
                        background: sc,
                        width: "22px",
                        height: "22px",
                        borderRadius: "4px",
                        border: style.strokeColor.toLowerCase() === sc.toLowerCase() ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.2)",
                        cursor: "pointer",
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "20px", paddingTop: "14px", borderTop: "1px solid rgba(255, 255, 255, 0.1)" }}>
          <button
            type="button"
            onClick={() => onChangeStyle(DEFAULT_INPLACE_STYLE)}
            style={{
              background: "transparent",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              color: "#94a3b8",
              borderRadius: "6px",
              padding: "6px 12px",
              fontSize: "0.76rem",
              cursor: "pointer",
            }}
          >
            ↺ Đặt lại mặc định
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onClose}
            style={{ padding: "6px 20px", fontSize: "0.82rem", fontWeight: 700 }}
          >
            ✓ Áp Dụng Kiểu Này
          </button>
        </div>
      </div>
    </div>
  );
};
