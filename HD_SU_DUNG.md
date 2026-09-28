# 🚀 HƯỚNG DẪN SỬ DỤNG STUDIO MINI - DESKTOP APP

Chào mừng bạn đến với **Studio Mini** - Ứng dụng lồng tiếng video tự động bằng trí tuệ nhân tạo (AI Voice Dubbing).

Ứng dụng hiện đã được đóng gói hoàn chỉnh dưới dạng **Desktop App**, bạn không cần phải mở terminal hay gõ lệnh thủ công nữa!

---

## 1. Cách Mở Ứng Dụng (1-Click Launch)

Bạn có 3 cách cực kỳ đơn giản để khởi chạy:

1. **Cách 1: Từ Màn hình chính (Desktop)** *(Khuyên dùng)*
   - Nhấp đúp vào biểu tượng **`Studio Mini AI`** trên Desktop của bạn.
   - Cửa sổ phần mềm sẽ tự động mở lên ngay lập tức.

2. **Cách 2: File Launcher Chạy Ngầm Trong Thư Mục**
   - Nhấp đúp vào file [`StudioMini.vbs`](file:///c:/Users/tango/Downloads/studio%20mini/StudioMini.vbs).
   - Ứng dụng sẽ mở cửa sổ Desktop êm ái, hoàn toàn không xuất hiện màn hình đen console.

3. **Cách 3: Chế Độ Có Xem Log Xử Lý (Debug Mode)**
   - Nhấp đúp vào file [`StudioMini.bat`](file:///c:/Users/tango/Downloads/studio%20mini/StudioMini.bat).
   - Màn hình đen sẽ hiển thị chi tiết tiến trình AI (tách nhạc Demucs, nhận diện Whisper, sinh giọng ZeroTTS...).

---

## 2. Các Tính Năng Chính

- **Lồng tiếng video AI tự động**:
  1. Tách giọng cũ và nhạc nền nguyên bản bằng **Demucs**.
  2. Nhận diện giọng nói chuẩn xác từng giây bằng **faster-whisper**.
  3. Dịch thông minh sang tiếng Việt theo phong cách thuyết minh phim.
  4. Lồng tiếng mới bằng mô hình **ZeroTTS 48kHz**.
  5. Đồng bộ timeline không chồng tiếng và mix nhạc nền chuyên nghiệp với **FFmpeg Studio Mixer**.
- **Kho giọng đọc ZeroTTS chất lượng cao**:
  - Hỗ trợ 8 giọng chuẩn: *Bảo Trang, Mai Chi, Kim Oanh, Hà My, Gia Huy, Hữu Đức, Quang Minh, Tiến Đạt*.
  - Hỗ trợ thêm các giọng cá nhân hóa (Cloned Voices).

---

## 3. Quản Trị & Phát Triển (Dành cho Developer)

Nếu bạn muốn build lại giao diện sau khi chỉnh sửa code frontend:
```powershell
pnpm --prefix frontend run build
```
Khởi chạy kiểm thử qua dòng lệnh:
```powershell
python desktop_app.py
```
Tạo lại shortcut trên Desktop nếu bị mất:
```powershell
python create_desktop_shortcut.py
```
