"use client";

import React, { useState, useRef } from "react";
import { Voice } from "@/types";
import { API_BASE } from "@/config";

interface VoiceLibraryProps {
  voices: Voice[];
  onRefreshVoices: () => void;
}

export const VoiceLibrary: React.FC<VoiceLibraryProps> = ({
  voices,
  onRefreshVoices,
}) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedAudio, setSelectedAudio] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [audioDragOver, setAudioDragOver] = useState(false);
  const [currentPlaying, setCurrentPlaying] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleAudioDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setAudioDragOver(false);
    if (e.dataTransfer.files.length) {
      setSelectedAudio(e.dataTransfer.files[0]);
    }
  };

  const handlePlayAudio = (path: string) => {
    // Nếu đang phát đúng file này -> ấn lại để dừng phát
    if (currentPlaying === path) {
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        audioPlayerRef.current = null;
      }
      setCurrentPlaying(null);
      return;
    }

    // Dừng file audio trước đó nếu đang chạy
    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
      audioPlayerRef.current = null;
    }

    const cleanPath = path.replace(/\\/g, "/");
    const audioUrl = cleanPath.startsWith("/") ? `${API_BASE}${cleanPath}` : `${API_BASE}/${cleanPath}`;
    const audio = new Audio(audioUrl);
    audioPlayerRef.current = audio;
    setCurrentPlaying(path);

    audio.play().catch((err) => {
      console.log("Lỗi phát audio:", err);
      setCurrentPlaying(null);
      audioPlayerRef.current = null;
    });

    audio.onended = () => {
      setCurrentPlaying(null);
      audioPlayerRef.current = null;
    };

    audio.onerror = () => {
      console.log("Lỗi tải file audio:", audioUrl);
      setCurrentPlaying(null);
      audioPlayerRef.current = null;
    };
  };

  const handleDeleteVoice = async (voiceId: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa giọng clone này khỏi kho?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/voices/${voiceId}`, { method: "DELETE" });
      if (res.ok) {
        onRefreshVoices();
      } else {
        let msg = "Không thể xóa giọng này.";
        try {
          const err = await res.json();
          if (err.detail) msg = err.detail;
        } catch {}
        alert(msg);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi kết nối tới server.";
      alert("Lỗi: " + msg);
    }
  };

  const handleCloneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAudio) {
      alert("Vui lòng chọn file âm thanh mẫu (3-30s sạch tiếng).");
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.append("name", name);
    formData.append("description", description);
    formData.append("audio_file", selectedAudio);

    try {
      const res = await fetch(`${API_BASE}/api/voices/clone`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Không thể tạo giọng clone.");
      }

      alert(`Đã thêm giọng "${name}" vào Kho Giọng Đọc thành công!`);
      setName("");
      setDescription("");
      setSelectedAudio(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      onRefreshVoices();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Đã xảy ra lỗi";
      alert("Lỗi: " + message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="voice-library-grid">
      {/* Left: Clone Form */}
      <div className="glass-card voice-upload-panel">
        <div className="card-header">
          <h2 className="card-title">Clone Giọng Đọc Mới</h2>
          <p className="card-desc">
            Tải lên đoạn ghi âm mẫu 3-30 giây sạch tiếng để tạo giọng đọc riêng
          </p>
        </div>

        <form onSubmit={handleCloneSubmit}>
          <div className="form-group">
            <label className="input-label" htmlFor="clone-name">
              Tên Giọng Đọc
            </label>
            <input
              type="text"
              id="clone-name"
              className="custom-input"
              placeholder="VD: Giọng Review Nam Trầm..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label className="input-label" htmlFor="clone-desc">
              Mô Tả / Đặc Điểm
            </label>
            <input
              type="text"
              id="clone-desc"
              className="custom-input"
              placeholder="VD: Giọng truyền cảm, đọc chậm rãi..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="input-label">
              File Ghi Âm Mẫu (3 - 30 giây sạch tiếng)
            </label>
            <div
              className={`dropzone ${audioDragOver ? "dragover" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setAudioDragOver(true);
              }}
              onDragLeave={() => setAudioDragOver(false)}
              onDrop={handleAudioDrop}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp3,audio/x-m4a"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.length) {
                    setSelectedAudio(e.target.files[0]);
                  }
                }}
              />
              {!selectedAudio ? (
                <div className="dropzone-content">
                  <div className="dropzone-icon">🎙️</div>
                  <p className="dropzone-title">Chọn file ghi âm .WAV hoặc .MP3</p>
                  <p className="dropzone-hint">
                    Không lẫn nhạc nền hoặc tiếng ồn để chất lượng clone chuẩn nhất
                  </p>
                </div>
              ) : (
                <div className="file-preview-card">
                  <div className="file-icon">🎵</div>
                  <div className="file-info">
                    <p className="file-name">{selectedAudio.name}</p>
                    <p className="file-size">
                      {(selectedAudio.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedAudio(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-glow btn-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              "Đang lưu & clone giọng..."
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="16"></line>
                  <line x1="8" y1="12" x2="16" y2="12"></line>
                </svg>
                Lưu & Thêm Vào Kho Giọng
              </>
            )}
          </button>
        </form>
      </div>

      {/* Right: Voices Grid */}
      <div className="glass-card voice-cards-panel">
        <div className="card-header header-with-badge">
          <div>
            <h2 className="card-title">Kho Giọng Đọc Hiện Có</h2>
            <p className="card-desc">
              Gồm 12 giọng tuyển chọn của VieNeu-TTS (CUDA) và các giọng clone độc quyền của bạn
            </p>
          </div>
          <button className="btn btn-secondary btn-sm" onClick={onRefreshVoices}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Làm mới
          </button>
        </div>

        <div className="voices-grid">
          {voices.map((v) => {
            const isPreset = v.type === "preset";
            return (
              <div key={v.id} className="voice-card">
                <div className="voice-card-top">
                  <h3 className="voice-card-title">{v.name}</h3>
                  <span className={isPreset ? "badge-preset" : "badge-cloned"}>
                    {isPreset ? "PRESET" : "CLONED"}
                  </span>
                </div>
                <p className="voice-card-desc">
                  {v.description || "Không có mô tả chi tiết."}
                </p>
                <div className="voice-card-actions">
                  {v.ref_audio_path ? (
                    <button
                      className="btn-listen"
                      onClick={() => handlePlayAudio(v.ref_audio_path!)}
                    >
                      {currentPlaying === v.ref_audio_path ? "⏹ Đang phát" : "▶ Nghe thử mẫu"}
                    </button>
                  ) : (
                    <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                      Built-in voice
                    </span>
                  )}
                  {!isPreset && (
                    <button
                      className="btn-delete"
                      onClick={() => handleDeleteVoice(v.id)}
                      title="Xóa giọng clone này"
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
