import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio Mini - AI Voice Dubbing Studio",
  description: "Lồng tiếng video AI tự động, giữ nguyên nhạc nền gốc và clone giọng độc quyền.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
