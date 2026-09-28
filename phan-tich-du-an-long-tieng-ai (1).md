# Phân tích & Thiết kế dự án: Web App Lồng Tiếng AI Tự Động (Studio Mini)

## 1. Mục tiêu & Định hướng dự án

Xây dựng một web app dạng **"Studio Lồng Tiếng AI Thu Nhỏ"** dành cho creator/video editor:
- **Tách biệt 2 tính năng chính**:
  1. **Quản lý Kho Giọng Đọc (Voice Library)**: Lưu trữ các giọng mặc định và cho phép người dùng upload file ghi âm riêng để clone và lưu lại sử dụng lâu dài.
  2. **Pipeline Lồng Tiếng Video Tự Động**: Tách bỏ giọng review/thoại cũ trong video gốc, giữ nguyên nhạc nền và hiệu ứng âm thanh (SFX), lồng giọng đọc AI mới đã chọn từ thư viện.
- **Quy mô**: Prototype/Studio cá nhân gọn nhẹ, tối ưu hóa chạy local, chi phí tối thiểu.

---

## 2. Kiến trúc Tổng thể Hệ thống

Hệ thống được chia làm 2 phân hệ độc lập:

### Phân hệ A: Quản lý Thư viện Giọng đọc (Voice Management)
```
File ghi âm mẫu (3 - 30s âm thanh sạch)
   │
   ▼
Tải lên hệ thống → ZeroTTS phân tích & trích xuất Reference Voice
   │
   ▼
Lưu trữ vào Kho Giọng (Preset Voices + Custom Cloned Voices)
(Hiển thị sẵn trong dropdown để user chọn bất kỳ lúc nào)
```

### Phân hệ B: Pipeline Lồng Tiếng Video (Video Dubbing Pipeline)
```
Video gốc + Lựa chọn giọng đọc từ Thư viện
   │
   ▼
[1] Upload video & Thiết lập cấu hình
   │
   ▼
[2] Tách audio bằng Demucs
   ├── Track A: Giọng nói review/nhân vật cũ trong video
   └── Track B: Nhạc nền + SFX (BẢO LƯU NGUYÊN BẢN)
   │
   ▼
[3] Speech-to-text (chạy trên Track A) → Lấy phụ đề + timestamp từng câu
   │
   ▼
[4] XÓA BỎ Track A (loại bỏ hoàn toàn giọng review cũ)
   │
   ▼
[5] Dịch văn bản sang tiếng Việt (giữ timestamp, tối ưu ngữ cảnh bằng LLM)
   │
   ▼
[6] ZeroTTS sinh giọng AI mới (theo giọng đã chọn ở Bước 1)
   │
   ▼
[7] Ghép các câu audio (Logic: "Câu sau đợi câu trước đọc xong", tránh đè tiếng)
   │
   ▼
[8] Mix track giọng mới với Track B (nhạc nền + SFX gốc)
   │
   ▼
[9] Ghép audio hoàn chỉnh vào video → Xuất video lồng tiếng mới
```

---

## 3. Chi tiết Kỹ thuật Từng Thành phần

### A. Quản lý Thư viện Giọng đọc (Voice Library)
* **Giọng có sẵn (Presets)**: 8 giọng tiếng Việt dựng sẵn của ZeroTTS (`maichi`, `baotrang`, `kimoanh`, `hamy`, `giahuy`, `huuduc`, `quangminh`, `tiendat`).
* **Clone giọng mới (Custom Voices)**:
  * User tải lên file ghi âm mẫu (`.wav`/`.mp3`, thời lượng từ 3 – 30 giây).
  * Điều kiện: File ghi âm sạch, không lẫn nhạc nền/tạp âm để đảm bảo chất lượng clone tốt nhất.
  * ZeroTTS lưu mẫu tham chiếu (reference audio) cùng tên định danh do user đặt (VD: *"Giọng Reviewer A"*, *"Giọng Trầm Kể Chuyện"*...).
  * Dữ liệu giọng lưu vào thư mục `voices/` và file danh mục `voices.json`.

---

### B. Pipeline Lồng tiếng Video

#### Bước 1 — Upload & Thiết lập
* Chọn video cần lồng tiếng (`.mp4`, `.mov`, `.mkv`).
* Chọn giọng đọc từ Thư viện giọng (Preset hoặc Custom Clone).
* Chọn ngôn ngữ gốc (hoặc để Auto-detect).

#### Bước 2 — Tách giọng review khỏi nhạc nền/SFX (Demucs)
* **Công cụ**: Demucs (`htdemucs` của Meta Research).
* **Input**: Audio tách từ video gốc (trích xuất nhanh qua FFmpeg).
* **Output**:
  * **Track A (Vocals)**: Giọng review / thoại cũ.
  * **Track B (No-vocals)**: Nhạc nền (BGM) + tiếng động môi trường/SFX.
* **Quy tắc**: Giữ nguyên vẹn Track B. Track A chỉ dùng tạm thời cho bước nhận diện rồi hủy bỏ.

#### Bước 3 — Speech-to-text (Nhận diện giọng nói)
* **Công cụ**: `faster-whisper` (chạy local trên CPU/GPU với CTranslate2).
* Chạy trực tiếp trên Track A.
* **Output**: Danh sách segments chứa `start_time`, `end_time`, `text`.

#### Bước 4 — Loại bỏ giọng cũ
* Hủy bỏ / giải phóng Track A khỏi bộ nhớ và ổ đĩa tạm, đảm bảo video cuối không còn tạp âm giọng cũ.

#### Bước 5 — Dịch văn bản sang tiếng Việt
* **Công cụ**: LLM API (Claude / GPT / DeepSeek).
* **Yêu cầu Prompt**: Dịch chuẩn ngữ cảnh, tự nhiên, văn phong nói/thuyết minh, hạn chế dịch câu quá dài để giữ nhịp độ tương đồng với video gốc.

#### Bước 6 — Text-to-speech (ZeroTTS)
* **Công cụ**: `zeroweight-ai/ZeroTTS` (ONNX Runtime).
* Nhận văn bản từng câu dịch + file giọng mẫu được chọn (hoặc mã giọng preset).
* Sinh file audio tiếng Việt chất lượng cao cho từng câu.

#### Bước 7 — Đồng bộ thời gian & Ghép Timeline
* **Vấn đề**: Câu dịch tiếng Việt thường dài hơn tiếng gốc. Ép cứng vào timestamp cũ sẽ gây chồng âm thanh (đè tiếng).
* **Thuật toán xử lý (Sequential Alignment)**:
  ```python
  current_time = 0.0
  for seg in segments:
      audio = zerotts_generate(seg.translated_text, voice=selected_voice)
      duration = get_duration(audio)
      
      # Câu sau chỉ bắt đầu khi câu trước đã đọc xong,
      # và không sớm hơn mốc thời gian xuất hiện trong video gốc
      actual_start = max(seg.start, current_time)
      place_audio(audio, at=actual_start)
      current_time = actual_start + duration
  ```

#### Bước 8 — Mix với Nhạc nền gốc (FFmpeg)
* Mix Track giọng mới (đã ghép timeline) cùng **Track B (Nhạc nền + SFX)** đã tách ở Bước 2.
* Có thể điều chỉnh volume (giảm nhẹ volume Track B khi có giọng đọc - ducking nhẹ nếu cần).

#### Bước 9 — Xuất video hoàn chỉnh
* Dùng FFmpeg ghép luồng hình ảnh gốc với luồng audio đã mix mới.
* Đầu ra: Video lồng tiếng sạch sẽ, khớp nhạc nền, giọng đọc tự nhiên.

---

## 4. Tech Stack Đề xuất

| Thành phần | Công nghệ / Thư viện | Vai trò |
|---|---|---|
| **Backend API** | Python + FastAPI | Xử lý API, điều phối background workers và streaming tiến trình |
| **Frontend UI** | HTML / CSS / JS (hoặc Vite React) | Giao diện Studio: Quản lý giọng + Upload & Preview video |
| **Tách Audio** | Demucs (`htdemucs`) | Tách Vocals và Background Music/SFX |
| **STT** | `faster-whisper` | Nhận diện giọng nói trích xuất timestamp siêu tốc |
| **Dịch thuật** | API LLM (Claude / OpenAI) | Dịch hội thoại ngữ cảnh tự nhiên |
| **TTS & Voice Clone** | `zerotts` (ZeroTTS) | Sinh giọng AI tiếng Việt & Clone giọng từ audio mẫu |
| **Xử lý Media** | `ffmpeg` | Cắt, ghép, mix âm thanh và render video cuối |

---

## 5. Lộ trình Triển khai Xây dựng Khung sườn (Skeleton Implementation)

1. **Giai đoạn 1: Chuẩn bị Cấu trúc Dự án & Môi trường**
   - Tạo cấu trúc thư mục chuẩn (`backend`, `storage/voices`, `storage/temp`, `frontend`).
   - Tạo file cấu hình và môi trường Python (`requirements.txt` / `pyproject.toml`).
2. **Giai đoạn 2: Xây dựng Module Quản lý Thư viện Giọng (Voice Bank)**
   - API / Script tiếp nhận file `.wav`/`.mp3` mẫu để tạo giọng clone mới.
   - Quản lý danh sách giọng (8 presets + danh sách custom voices).
3. **Giai đoạn 3: Xây dựng Core Pipeline Engine**
   - Script Python tuần tự: Nhận video -> Demucs tách track -> Whisper STT -> Dịch -> ZeroTTS sinh giọng -> Timeline Alignment -> FFmpeg mix -> Xuất video.
4. **Giai đoạn 4: Xây dựng Backend FastAPI & WebSocket/SSE**
   - Bọc Core Engine vào Background Task, bắn sự kiện tiến trình (Progress 0% -> 100%) cho từng bước.
5. **Giai đoạn 5: Xây dựng Giao diện Web Studio**
   - Màn hình Quản lý Voice Bank (upload mẫu, nghe thử giọng).
   - Màn hình Studio Lồng Tiếng (upload video, chọn giọng, xem thanh tiến độ và preview video kết quả).
