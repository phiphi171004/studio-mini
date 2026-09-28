# Studio Mini — AI Voice Dubbing & Video Studio

> **Ứng dụng Desktop tự động hóa lồng tiếng AI, xóa sub thông minh và biên tập video đa nền tảng (Douyin, TikTok, Xiaohongshu, Kuaishou, Bilibili...).**

---

## 🌟 Tính năng nổi bật

- 🎙️ **Lồng tiếng AI Tiếng Việt cảm xúc (VieNeu-TTS 3.8.3)**:
  - Hỗ trợ hơn 12+ preset giọng đọc tự nhiên đa vùng miền (Hải Đăng, Thiện Minh, Mai Anh, Trúc Ly, Ngọc Huyền, Quốc Tuấn...).
  - Nhân bản giọng nói (Zero-shot Voice Cloning) từ file âm thanh mẫu.
  - Tối ưu tăng tốc phần cứng GPU NVIDIA CUDA.
- ⚡ **Tải video không Watermark / Logo**:
  - Hỗ trợ Douyin, TikTok, Xiaohongshu, Kuaishou, Bilibili siêu tốc.
  - Nạp video trực tiếp vào Studio chỉ với 1 click.
- 🧹 **Xóa Sub Gốc / Chữ Video (Inpainting AI + OCR)**:
  - Tự động nhận diện phụ đề tiếng Trung/Anh và xóa chữ mượt mà.
  - Hỗ trợ đè nền thông minh (Inplace Overlay) với tùy chỉnh viền bo tròn, kích cỡ chữ và màu sắc.
- 📝 **Dịch thuật & Căn chỉnh dòng thời gian tự động**:
  - Tự động dịch phụ đề chuẩn phong cách tiếng Việt tự nhiên qua Gemini AI.
  - Đồng bộ âm thanh lồng tiếng khớp từng giây với video gốc (Smart Timeline Alignment).

---

## 🛠️ Yêu cầu hệ thống

- **Hệ điều hành**: Windows 10 / 11 (64-bit).
- **Phần mềm**: Python 3.11+, Node.js 18+ (sử dụng `pnpm`), FFmpeg.
- **Card đồ họa (Khuyến nghị)**: NVIDIA GTX 1050 trở lên (hỗ trợ CUDA) để đạt tốc độ xử lý AI tối đa.

---

## 🚀 Khởi chạy ứng dụng (Dành cho nhà phát triển)

### 1. Cài đặt Dependencies
```bash
# Frontend
cd frontend
pnpm install
pnpm build
cd ..

# Backend
python -m pip install -r requirements.txt # hoặc cài đặt các gói cần thiết
```

### 2. Thiết lập Môi trường
Sao chép `.env.example` thành `.env` và điền API key của bạn:
```bash
cp .env.example .env
```

### 3. Chạy ứng dụng Desktop
```bash
pnpm start
```

---

## 📄 Bản quyền & Đóng góp
Dự án được phát triển phục vụ sáng tạo nội dung video và affiliate marketing tự động. Mọi đóng góp vui lòng mở Pull Request hoặc Issue trên GitHub Repository.
