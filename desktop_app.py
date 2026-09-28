"""
STUDIO MINI - NATIVE WINDOWS DESKTOP APPLICATION
================================================
Khởi chạy trọn gói Studio Mini (FastAPI Backend + Next.js UI)
dưới dạng ứng dụng Desktop Windows hoàn chỉnh (1-Click chạy ngay).
"""

import sys
import os
import time
import threading
import subprocess
import logging
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
LOG_FILE = PROJECT_ROOT / "desktop_app.log"

# Khi chạy bằng pythonw.exe, sys.stdout và sys.stderr là None
# Cần gán chúng tới file log để uvicorn và các thư viện không bị crash
if sys.stdout is None or not hasattr(sys.stdout, "write"):
    sys.stdout = open(str(LOG_FILE), "a", encoding="utf-8", buffering=1)
if sys.stderr is None or not hasattr(sys.stderr, "write"):
    sys.stderr = open(str(LOG_FILE), "a", encoding="utf-8", buffering=1)

# Cấu hình ghi log ra file để dễ chuẩn đoán nếu có sự cố
logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    encoding="utf-8"
)

def log_print(msg: str):
    """In ra màn hình và đồng thời lưu vào file log."""
    logging.info(msg)
    try:
        print(msg, flush=True)
    except Exception:
        pass

HOST = "127.0.0.1"
PORT = 8000
APP_URL = f"http://{HOST}:{PORT}"
APP_TITLE = "Studio Mini - AI Voice Dubbing"

class UvicornServerThread(threading.Thread):
    """Luồng chạy ngầm server FastAPI."""
    def __init__(self, host=HOST, port=PORT):
        super().__init__(daemon=True)
        self.host = host
        self.port = port
        self.server = None

    def run(self):
        try:
            import uvicorn
            from backend.app.main import app
            
            config = uvicorn.Config(
                app=app,
                host=self.host,
                port=self.port,
                log_config=None,
                access_log=False
            )
            self.server = uvicorn.Server(config)
            self.server.run()
        except Exception as e:
            logging.error(f"Uvicorn thread error: {e}", exc_info=True)


    def stop(self):
        if self.server:
            self.server.should_exit = True

def is_backend_alive() -> bool:
    """Kiểm tra server FastAPI có đang phản hồi không."""
    health_url = f"{APP_URL}/api/health"
    try:
        with urllib.request.urlopen(health_url, timeout=1) as response:
            return response.status == 200
    except Exception:
        return False

def wait_for_backend(timeout=20) -> bool:
    """Chờ server FastAPI khởi động thành công."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if is_backend_alive():
            return True
        time.sleep(0.3)
    return False

def run_app_mode_browser(url: str):
    """
    Mở giao diện dưới dạng Desktop Application Window
    sử dụng Microsoft Edge / Chrome App Mode (không thanh địa chỉ, không tab).
    """
    edge_paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%LocalAppData%\Microsoft\Edge\Application\msedge.exe"),
    ]
    chrome_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]

    browser_exe = None
    for p in edge_paths + chrome_paths:
        if os.path.exists(p):
            browser_exe = p
            break

    if browser_exe:
        log_print(f"[DesktopApp] Opening native app window via: {Path(browser_exe).name}")
        cmd = [
            browser_exe,
            f"--app={url}",
            "--window-size=1280,820",
            "--window-position=center",
            "--disable-features=Translate"
        ]
        proc = subprocess.Popen(cmd)
        proc.wait()
        log_print("[DesktopApp] App window closed by user.")
    else:
        import webbrowser
        log_print("[DesktopApp] Opening default browser...")
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            pass

def main():
    log_print("=" * 60)
    log_print("  STUDIO MINI - AI VOICE DUBBING DESKTOP")
    log_print(f"  URL: {APP_URL}")
    log_print("=" * 60)

    server_thread = None

    # 1. Kiểm tra xem Backend đã chạy sẵn từ trước chưa
    if is_backend_alive():
        log_print("[DesktopApp] Backend is already running and ready!")
    else:
        log_print("[DesktopApp] Starting FastAPI background server...")
        server_thread = UvicornServerThread(host=HOST, port=PORT)
        server_thread.start()

        if not wait_for_backend(timeout=25):
            log_print("[DesktopApp] Warning: Backend took longer than expected to start.")
        else:
            log_print("[DesktopApp] Backend started successfully!")

    # 2. Khởi chạy cửa sổ Desktop Window
    log_print("[DesktopApp] Launching Desktop Window...")

    # Ưu tiên mở cửa sổ Application Mode (Edge/Chrome Native App Mode)
    # Đây là chuẩn ổn định nhất 100% trên Windows 10/11, không bị xung đột .NET/CLR
    try:
        run_app_mode_browser(APP_URL)
    except Exception as e:
        log_print(f"[DesktopApp] Error opening window: {e}")
    finally:
        if server_thread:
            log_print("[DesktopApp] Shutting down backend...")
            server_thread.stop()
        log_print("[DesktopApp] Application exited cleanly.")

if __name__ == "__main__":
    main()
