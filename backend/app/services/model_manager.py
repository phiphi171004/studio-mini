import os
import sys
import time
import asyncio
import threading
import urllib.request
from pathlib import Path
from typing import Dict, Any, Optional

MODELS_CONFIG: Dict[str, Dict[str, Any]] = {
    "big_lama": {
        "name": "Big-LaMa AI (PyTorch CUDA)",
        "filename": "big-lama.pt",
        "size_mb": 196,
        "urls": [
            "https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt",
            "https://huggingface.co/fashn-ai/LaMa/resolve/main/big-lama.pt"
        ],
        "description": "Mô hình xóa chữ chất lượng cao nhất cho card rời NVIDIA",
        "min_size_bytes": 100_000_000
    },
    "directml_onnx": {
        "name": "LaMa AI (DirectML ONNX)",
        "filename": "lama.onnx",
        "size_mb": 197,
        "urls": [
            "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama.onnx"
        ],
        "description": "Mô hình siêu nhẹ, tiết kiệm VRAM cho GPU yếu / Laptop",
        "min_size_bytes": 100_000_000
    },
    "yolo_text": {
        "name": "YOLO-Text Detector",
        "filename": "yolo11n-text.pt",
        "size_mb": 5.2,
        "urls": [],
        "description": "Nhận diện vị trí chữ và phụ đề trên video",
        "min_size_bytes": 3_000_000
    }
}

class ModelManagerService:
    _download_tasks: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def get_models_dir(cls) -> Path:
        models_dir = Path(__file__).resolve().parent.parent.parent / "models"
        models_dir.mkdir(parents=True, exist_ok=True)
        return models_dir

    @classmethod
    def get_status(cls) -> Dict[str, Any]:
        """Kiểm tra trạng thái các model trong thư mục models/"""
        models_dir = cls.get_models_dir()
        result = {}
        for key, conf in MODELS_CONFIG.items():
            file_path = models_dir / conf["filename"]
            exists = file_path.exists()
            file_size = file_path.stat().st_size if exists else 0
            is_valid = exists and (file_size >= conf["min_size_bytes"])

            active_task = cls._download_tasks.get(key, {})
            result[key] = {
                "key": key,
                "name": conf["name"],
                "filename": conf["filename"],
                "size_mb": conf["size_mb"],
                "description": conf["description"],
                "downloaded": is_valid,
                "current_size_bytes": file_size,
                "downloading": active_task.get("status") == "downloading",
                "progress": active_task.get("progress", 0),
                "speed_mbps": active_task.get("speed_mbps", 0.0),
                "error": active_task.get("error")
            }
        return result

    @classmethod
    def is_model_downloaded(cls, model_key: str) -> bool:
        models_dir = cls.get_models_dir()
        conf = MODELS_CONFIG.get(model_key)
        if not conf:
            return False
        file_path = models_dir / conf["filename"]
        return file_path.exists() and (file_path.stat().st_size >= conf["min_size_bytes"])

    @classmethod
    def get_progress(cls, model_key: str) -> Dict[str, Any]:
        if model_key in cls._download_tasks:
            return cls._download_tasks[model_key]
        is_dl = cls.is_model_downloaded(model_key)
        return {
            "status": "completed" if is_dl else "idle",
            "progress": 100 if is_dl else 0,
            "speed_mbps": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "error": None
        }

    @classmethod
    def start_download(cls, model_key: str) -> Dict[str, Any]:
        """Bắt đầu tải model ngầm"""
        if model_key not in MODELS_CONFIG:
            raise ValueError(f"Model key '{model_key}' không hợp lệ.")

        conf = MODELS_CONFIG[model_key]
        if cls.is_model_downloaded(model_key):
            return {"status": "already_downloaded", "message": f"Model {conf['name']} đã có sẵn trong máy."}

        active = cls._download_tasks.get(model_key, {})
        if active.get("status") == "downloading":
            return {"status": "in_progress", "progress": active.get("progress", 0)}

        # Bắt đầu thread tải ngầm
        cls._download_tasks[model_key] = {
            "status": "downloading",
            "progress": 0,
            "speed_mbps": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": conf["size_mb"] * 1024 * 1024,
            "error": None
        }

        t = threading.Thread(target=cls._download_worker, args=(model_key,), daemon=True)
        t.start()
        return {"status": "started", "message": f"Bắt đầu tải {conf['name']}..."}

    @classmethod
    def _download_worker(cls, model_key: str):
        conf = MODELS_CONFIG[model_key]
        models_dir = cls.get_models_dir()
        target_path = models_dir / conf["filename"]
        temp_path = models_dir / f"{conf['filename']}.part"

        urls = conf["urls"]
        if not urls:
            cls._download_tasks[model_key] = {
                "status": "error",
                "progress": 0,
                "error": f"Không có URL tải về cho model {conf['name']}."
            }
            return

        success = False
        last_error = ""

        for url in urls:
            try:
                print(f"[ModelManager] Đang tải {conf['name']} từ: {url}...")
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    total_bytes = int(resp.headers.get("Content-Length", conf["size_mb"] * 1024 * 1024))
                    downloaded_bytes = 0
                    start_time = time.time()
                    last_update_time = start_time

                    with open(temp_path, "wb") as f_out:
                        chunk_size = 128 * 1024  # 128 KB
                        while True:
                            chunk = resp.read(chunk_size)
                            if not chunk:
                                break
                            f_out.write(chunk)
                            downloaded_bytes += len(chunk)

                            now = time.time()
                            if now - last_update_time >= 0.2:  # Cập nhật mỗi 200ms
                                elapsed = now - start_time
                                speed_mbps = (downloaded_bytes / (1024 * 1024)) / elapsed if elapsed > 0 else 0.0
                                progress = min(99, int((downloaded_bytes / total_bytes) * 100)) if total_bytes > 0 else 0
                                cls._download_tasks[model_key] = {
                                    "status": "downloading",
                                    "progress": progress,
                                    "speed_mbps": round(speed_mbps, 2),
                                    "downloaded_bytes": downloaded_bytes,
                                    "total_bytes": total_bytes,
                                    "error": None
                                }
                                last_update_time = now

                # Hoàn thành: Đổi tên file tạm
                if temp_path.exists() and temp_path.stat().st_size >= conf["min_size_bytes"]:
                    if target_path.exists():
                        target_path.unlink()
                    temp_path.rename(target_path)
                    cls._download_tasks[model_key] = {
                        "status": "completed",
                        "progress": 100,
                        "speed_mbps": 0.0,
                        "downloaded_bytes": target_path.stat().st_size,
                        "total_bytes": target_path.stat().st_size,
                        "error": None
                    }
                    print(f"[ModelManager] Tải hoàn tất {conf['name']} ({target_path.stat().st_size / 1024 / 1024:.1f} MB)!")
                    success = True
                    break
                else:
                    raise RuntimeError("Kích thước file tải về không hợp lệ.")

            except Exception as e:
                last_error = str(e)
                print(f"[ModelManager] Lỗi tải từ {url}: {e}")
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                    except Exception:
                        pass

        if not success:
            cls._download_tasks[model_key] = {
                "status": "error",
                "progress": 0,
                "speed_mbps": 0.0,
                "error": f"Lỗi tải model: {last_error}"
            }

    @classmethod
    def delete_model(cls, model_key: str) -> bool:
        conf = MODELS_CONFIG.get(model_key)
        if not conf:
            return False
        models_dir = cls.get_models_dir()
        target_path = models_dir / conf["filename"]
        if target_path.exists():
            target_path.unlink()
            if model_key in cls._download_tasks:
                del cls._download_tasks[model_key]
            return True
        return False
