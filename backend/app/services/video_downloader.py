import os
import re
import uuid
import asyncio
import urllib.request
import httpx
from pathlib import Path
from typing import Dict, Any, Optional
from ..config import UPLOADS_DIR

SNAP_API_URL = "https://snapvideotools.com/vi/api/snap"

SNAP_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": "https://snapvideotools.com",
    "Referer": "https://snapvideotools.com/vi",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
}

BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
}

def extract_url(text: str) -> Optional[str]:
    """Bóc tách URL từ văn bản hoặc chuỗi chia sẻ."""
    if not text:
        return None
    match = re.search(r'https?://[^\s<>"]+', text.strip())
    if match:
        url = match.group(0)
        url = re.sub(r'[\.,;!?\)\]\}]+$', '', url)
        return url
    return None

def detect_platform(url: str) -> str:
    """Tự động nhận diện nền tảng từ URL."""
    u = url.lower()
    if "douyin.com" in u:
        return "douyin"
    if "kuaishou.com" in u or "kwai" in u:
        return "kuaishou"
    if "xiaohongshu.com" in u or "xhslink" in u:
        return "xiaohongshu"
    if "bilibili.com" in u:
        return "bilibili"
    return "douyin" if ("v.douyin" in u) else "tiktok"

def sanitize_filename(name: str, max_length: int = 50) -> str:
    """Tạo tên file an toàn từ tiêu đề video, loại bỏ ký tự đặc biệt."""
    if not name:
        return "video"
    cleaned = re.sub(r'[#%&?？！!\\/*:"<>|~`\'"^$\s]+', "_", name)
    cleaned = re.sub(r'_+', "_", cleaned).strip("_")
    if not cleaned:
        cleaned = "video"
    return cleaned[:max_length]

async def resolve_and_validate_url(url: str) -> str:
    """
    Theo dõi chuyển hướng của các liên kết rút gọn (như v.douyin.com, vt.tiktok.com, xhslink.com)
    để phát hiện sớm liên kết chết / video đã bị xóa / quyền riêng tư.
    """
    if "v.douyin.com" in url or "vt.tiktok.com" in url or "xhslink.com" in url:
        try:
            async with httpx.AsyncClient(timeout=10.0, follow_redirects=False, headers=BROWSER_HEADERS) as client:
                resp = await client.get(url)
                if resp.status_code in (301, 302, 303, 307, 308):
                    loc = resp.headers.get("location", "").strip()
                    if loc:
                        # Kiểm tra Douyin: Nếu redirect về trang chủ Douyin chứng tỏ video đã bị xóa hoặc ẩn riêng tư
                        if "v.douyin.com" in url:
                            clean_loc = loc.split("?")[0].rstrip("/")
                            if clean_loc in ("https://www.douyin.com", "http://www.douyin.com", "https://douyin.com", "http://douyin.com"):
                                raise ValueError("Video trên Douyin này không tồn tại (có thể đã bị tác giả xóa, chuyển sang chế độ riêng tư hoặc liên kết chia sẻ đã hết hạn). Bạn vui lòng thử video khác!")
                        return loc
        except ValueError:
            raise
        except Exception:
            pass
    return url

async def fetch_video_info(url_or_text: str) -> Dict[str, Any]:
    """
    Sử dụng API SnapVideoTools (https://snapvideotools.com/vi/api/snap) để lấy link tải video không watermark từ
    Douyin, TikTok, Xiaohongshu, Kuaishou, Bilibili...
    """
    text_content = url_or_text.strip() if url_or_text else ""
    if not text_content:
        raise ValueError("Vui lòng dán liên kết hoặc đoạn văn bản chia sẻ video.")

    extracted_url = extract_url(text_content)
    if not extracted_url:
        raise ValueError("Không tìm thấy đường link hợp lệ trong nội dung bạn cung cấp.")

    # 1. Tiền kiểm tra liên kết rút gọn
    resolved_url = await resolve_and_validate_url(extracted_url)

    # 2. Gửi request phân tích video qua SnapVideoTools API
    payload = {
        "text": text_content
    }

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.post(SNAP_API_URL, json=payload, headers=SNAP_HEADERS)
            resp.raise_for_status()
            res_json = resp.json()
    except httpx.HTTPStatusError as e:
        err_msg = ""
        try:
            err_data = e.response.json()
            if isinstance(err_data, dict) and err_data.get("message"):
                err_msg = err_data["message"]
        except Exception:
            err_msg = e.response.text[:200]

        if e.response.status_code == 429:
            raise RuntimeError("Máy chủ tải video đang bận xử lý nhiều yêu cầu (Rate Limit). Vui lòng thử lại sau giây lát.")

        if err_msg:
            raise RuntimeError(f"Máy chủ tải video báo lỗi: {err_msg}")
        raise RuntimeError(f"Lỗi máy chủ phân tích video ({e.response.status_code})")
    except Exception as e:
        raise RuntimeError(f"Lỗi khi gửi yêu cầu phân tích video: {str(e)}")

    if res_json.get("code") != 0 or not res_json.get("data"):
        err_msg = res_json.get("message") or "Không thể phân tích video từ đường link này (có thể video ở chế độ riêng tư hoặc link đã hết hạn)."
        raise RuntimeError(err_msg)

    data = res_json["data"]
    media_urls = data.get("mediaUrls", [])
    if not isinstance(media_urls, list) or len(media_urls) == 0:
        raise RuntimeError("Không tìm thấy tài nguyên video từ liên kết này.")

    # Lọc danh sách video
    video_items = [m for m in media_urls if isinstance(m, dict) and m.get("type") == "video" and m.get("url")]
    if not video_items:
        raise RuntimeError("Không tìm thấy liên kết video trực tiếp không logo.")

    # Ưu tiên lấy video đầu tiên (thường là chất lượng HD cao nhất)
    video_url = video_items[0]["url"]

    # Tìm audio đính kèm nếu có
    audio_items = [m for m in media_urls if isinstance(m, dict) and m.get("type") == "audio" and m.get("url")]
    music_url = audio_items[0]["url"] if audio_items else ""

    title = data.get("title") or "Video tải về"
    cover_url = data.get("cover") or ""
    platform = (data.get("platformKey") or data.get("platformName") or detect_platform(extracted_url)).lower()

    return {
        "status": "success",
        "title": title,
        "video_url": video_url,
        "cover_url": cover_url,
        "duration": 0,  # Frontend sẽ tự động đọc chính xác từ metadata của video_url
        "platform": platform,
        "music": music_url,
        "original_url": data.get("orignalUrl") or extracted_url,
    }

async def download_video_file(video_url: str, title: str = "", platform: str = "") -> Dict[str, Any]:
    """
    Tải video siêu tốc từ CDN và lưu vào thư mục storage/uploads/ với tên file chuẩn an toàn.
    """
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

    # Thiết lập Referer phù hợp theo nền tảng
    referer = "https://www.douyin.com/"
    plat = (platform or "douyin").lower()
    if "tiktok" in plat:
        referer = "https://www.tiktok.com/"
    elif "bilibili" in plat:
        referer = "https://www.bilibili.com/"
    elif "kuaishou" in plat:
        referer = "https://www.kuaishou.com/"
    elif "xiaohongshu" in plat:
        referer = "https://www.xiaohongshu.com/"

    download_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
        "Referer": referer,
        "Accept": "*/*",
    }

    unique_suffix = uuid.uuid4().hex[:10]
    safe_plat = re.sub(r'[^a-zA-Z0-9_]', '', plat) or "video"
    filename = f"video_{safe_plat}_{unique_suffix}.mp4"
    save_path = UPLOADS_DIR / filename

    def _threaded_download():
        req = urllib.request.Request(video_url, headers=download_headers)
        with urllib.request.urlopen(req, timeout=60) as resp, open(save_path, "wb") as f:
            while True:
                chunk = resp.read(1024 * 512)  # Buffer 512KB siêu tốc
                if not chunk:
                    break
                f.write(chunk)

    try:
        await asyncio.to_thread(_threaded_download)
    except Exception as e:
        if save_path.exists():
            save_path.unlink(missing_ok=True)
        raise RuntimeError(f"Lỗi khi tải file video về máy chủ: {str(e)}")

    if not save_path.exists() or save_path.stat().st_size == 0:
        if save_path.exists():
            save_path.unlink(missing_ok=True)
        raise RuntimeError("Tải video thất bại (file rỗng).")

    return {
        "status": "success",
        "filename": filename,
        "file_path": str(save_path),
        "file_url": f"/storage/uploads/{filename}",
        "file_size": save_path.stat().st_size,
        "title": title or filename,
        "platform": platform,
    }
