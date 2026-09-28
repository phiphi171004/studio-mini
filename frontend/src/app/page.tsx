"use client";

import React, { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { DubbingStudio } from "@/components/DubbingStudio";
import { VoiceLibrary } from "@/components/VoiceLibrary";
import { SubtitleRemover } from "@/components/SubtitleRemover";
import { SettingsModal } from "@/components/SettingsModal";
import { VideoDownloaderModal } from "@/components/VideoDownloaderModal";
import { Voice } from "@/types";
import { API_BASE } from "@/config";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"dubbing" | "voices" | "subtitle-remover">("dubbing");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [isBackendConnected, setIsBackendConnected] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isDownloaderOpen, setIsDownloaderOpen] = useState<boolean>(false);

  // Video sạch từ tab Xóa Phụ Đề hoặc Video Tải Về chuyển qua
  const [cleanVideoUrl, setCleanVideoUrl] = useState<string | null>(null);
  const [cleanVideoFile, setCleanVideoFile] = useState<File | null>(null);

  // Fetch voices from Backend
  const fetchVoices = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/voices`);
      if (!res.ok) throw new Error();
      const data: Voice[] = await res.json();
      setVoices(data);
      setIsBackendConnected(true);
    } catch {
      setIsBackendConnected(false);
    }
  };

  useEffect(() => {
    fetchVoices();
    const interval = setInterval(fetchVoices, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleTabChange = (newTab: "dubbing" | "voices" | "subtitle-remover") => {
    setActiveTab(newTab);
    if (newTab === "subtitle-remover") {
      // Tự động nạp ngầm mô hình LaMa & OCR khi người dùng chuyển sang tab Xóa Phụ Đề
      fetch(`${API_BASE}/api/subtitle-remover/warmup`, { method: "POST" }).catch(() => {});
    } else {
      // Giải phóng VRAM khi rời tab Xóa Phụ Đề để nhường chỗ cho Lồng tiếng
      fetch(`${API_BASE}/api/system/cleanup-vram`, { method: "POST" }).catch(() => {});
    }
  };

  const handleSendToDubbing = (videoUrl: string, originalFile?: File | null) => {
    setCleanVideoUrl(videoUrl);
    if (originalFile) {
      setCleanVideoFile(originalFile);
    }
    handleTabChange("dubbing");
  };

  return (
    <>
      <Header
        activeTab={activeTab}
        onTabChange={handleTabChange}
        voiceCount={voices.length}
        isBackendConnected={isBackendConnected}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenDownloader={() => setIsDownloaderOpen(true)}
      />

      <main className="main-content">
        {activeTab === "dubbing" ? (
          <DubbingStudio
            voices={voices}
            onNavigateToVoices={() => setActiveTab("voices")}
            initialVideoUrl={cleanVideoUrl}
            initialVideoFile={cleanVideoFile}
          />
        ) : activeTab === "voices" ? (
          <VoiceLibrary voices={voices} onRefreshVoices={fetchVoices} />
        ) : (
          <SubtitleRemover onSendToDubbing={handleSendToDubbing} />
        )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      <VideoDownloaderModal
        isOpen={isDownloaderOpen}
        onClose={() => setIsDownloaderOpen(false)}
        onSelectVideoForStudio={(file, previewUrl) => {
          setCleanVideoFile(file);
          setCleanVideoUrl(previewUrl);
          setActiveTab("dubbing");
        }}
      />
    </>
  );
}

