const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");
const { spawn, execSync } = require("child_process");

let mainWindow = null;
let splashWindow = null;
let pythonProcess = null;
const PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

// Thư mục lưu môi trường độc lập khi đóng gói sang máy khác
const USER_DATA = app.getPath("userData");
const RUNTIME_DIR = path.join(USER_DATA, "runtime");

// Đọc thông tin cấu hình từ version.json
let appConfig = {
  version: "1.0.0",
  repo: "phiphi171004/studio-mini",
  runtime_download_url: "https://github.com/phiphi171004/studio-mini/releases/download/v1.0.0/studio-mini-runtime.zip"
};

try {
  const versionFile = path.join(__dirname, "version.json");
  if (fs.existsSync(versionFile)) {
    appConfig = JSON.parse(fs.readFileSync(versionFile, "utf-8"));
  }
} catch (e) {
  console.error("[Config] Error reading version.json:", e);
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 460,
    height: 290,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, "splash.html"));
  splashWindow.once("ready-to-show", () => {
    splashWindow.show();
  });
}

function updateSplashProgress(percent, status, detail = "") {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send("setup-progress", { percent, status, detail });
  }
}

function checkBackendReady(timeoutMs = 25000) {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const req = http.get(HEALTH_URL, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      });
      req.on("error", () => retry());
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startTime < timeoutMs) {
        setTimeout(check, 400);
      } else {
        resolve(false);
      }
    };

    check();
  });
}

function findExistingPython() {
  // 1. Kiểm tra Python trong thư mục runtime nội bộ của app
  const runtimePy = path.join(RUNTIME_DIR, "python", "python.exe");
  if (fs.existsSync(runtimePy)) {
    return runtimePy;
  }

  // 2. Kiểm tra Python cài sẵn trên máy (Local dev)
  const localAppData = process.env.LOCALAPPDATA || "";
  const py311 = path.join(localAppData, "Programs", "Python", "Python311", "python.exe");
  if (fs.existsSync(py311)) {
    return py311;
  }

  // 3. Kiểm tra biến môi trường PATH
  try {
    const out = execSync("python -c \"import sys; print(sys.version_info.major)\"", { stdio: ["pipe", "pipe", "ignore"] });
    if (out.toString().trim() === "3") {
      return "python";
    }
  } catch (e) {
    // Không có python
  }

  return null;
}

function downloadFileWithProgress(fileUrl, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let downloadedBytes = 0;
    let totalBytes = 0;
    let lastTime = Date.now();
    let lastBytes = 0;

    const request = (url) => {
      const protocol = url.startsWith("https") ? https : http;
      protocol.get(url, { headers: { "User-Agent": "StudioMini-Installer/1.0" } }, (res) => {
        // Hỗ trợ redirect (301, 302 từ GitHub Release)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Tải file thất bại với mã lỗi HTTP ${res.statusCode}`));
        }

        totalBytes = parseInt(res.headers["content-length"] || "0", 10);

        res.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          file.write(chunk);

          const now = Date.now();
          if (now - lastTime > 400 || downloadedBytes === totalBytes) {
            const timeDiff = (now - lastTime) / 1000;
            const bytesDiff = downloadedBytes - lastBytes;
            const speedMB = (bytesDiff / (1024 * 1024)) / (timeDiff || 1);
            const percent = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
            const downloadedMB = (downloadedBytes / (1024 * 1024)).toFixed(1);
            const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);

            onProgress({
              percent,
              downloadedMB,
              totalMB,
              speedMB: speedMB.toFixed(1)
            });

            lastTime = now;
            lastBytes = downloadedBytes;
          }
        });

        res.on("end", () => {
          file.end();
          resolve(destPath);
        });

        res.on("error", (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };

    request(fileUrl);
  });
}

function extractZipFile(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    try {
      // Dùng lệnh tar (Windows 10/11 có sẵn 100% cực nhanh)
      execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: "ignore" });
      resolve(true);
    } catch (err) {
      // Dự phòng bằng PowerShell nếu tar gặp sự cố
      try {
        execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: "ignore" });
        resolve(true);
      } catch (err2) {
        reject(err2);
      }
    }
  });
}

async function prepareRuntimeEnvironment() {
  updateSplashProgress(10, "Kiểm tra môi trường hệ thống...", "Đang rà soát động cơ Python & GPU");

  let pyPath = findExistingPython();

  // Nếu máy đã có Python (như máy của bạn hiện tại) -> Bỏ qua bước tải
  if (pyPath) {
    updateSplashProgress(60, "Động cơ AI sẵn sàng!", "Đang chuẩn bị khởi động máy chủ...");
    return pyPath;
  }

  // Nếu máy chưa có Python (máy người khác) -> Tự động tải từ GitHub Releases
  updateSplashProgress(15, "Đang kết nối kho tài nguyên đám mây...", "Chuẩn bị tải môi trường Studio Mini AI");
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const tempZip = path.join(RUNTIME_DIR, "runtime_temp.zip");

  try {
    updateSplashProgress(20, "Đang tải môi trường AI từ GitHub...", "Quá trình này chỉ diễn ra 1 lần duy nhất");
    await downloadFileWithProgress(appConfig.runtime_download_url, tempZip, (p) => {
      const scaledPercent = 20 + (p.percent * 0.6); // 20% -> 80%
      updateSplashProgress(
        scaledPercent,
        `Đang tải tài nguyên AI (${Math.round(p.percent)}%)...`,
        `Đã tải ${p.downloadedMB}MB / ${p.totalMB}MB • Tốc độ: ${p.speedMB} MB/s`
      );
    });

    updateSplashProgress(85, "Đang giải nén và thiết lập môi trường...", "Vui lòng đợi giây lát...");
    await extractZipFile(tempZip, RUNTIME_DIR);

    // Xóa file nén tạm sau khi giải nén
    if (fs.existsSync(tempZip)) {
      fs.unlinkSync(tempZip);
    }

    updateSplashProgress(95, "Hoàn tất thiết lập!", "Đang khởi động ứng dụng...");
    pyPath = path.join(RUNTIME_DIR, "python", "python.exe");
    return pyPath;
  } catch (err) {
    console.error("[Setup] Failed to download/extract runtime:", err);
    updateSplashProgress(0, "Lỗi cài đặt tài nguyên!", err.message);
    throw err;
  }
}

function startBackendServer(pyPath) {
  return new Promise(async (resolve) => {
    const isAlreadyRunning = await checkBackendReady(1500);
    if (isAlreadyRunning) {
      console.log("[Electron] Backend is already running on port 8000.");
      return resolve(true);
    }

    console.log(`[Electron] Starting Python FastAPI backend with: ${pyPath}`);
    pythonProcess = spawn(pyPath, ["run_server.py"], {
      cwd: __dirname,
      stdio: "ignore",
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUNBUFFERED: "1"
      },
      detached: false
    });

    pythonProcess.on("error", (err) => {
      console.error("[Electron] Failed to start Python process:", err);
    });

    const ready = await checkBackendReady(30000);
    resolve(ready);
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1024,
    minHeight: 680,
    title: "Studio Mini - AI Voice Dubbing Studio",
    icon: path.join(__dirname, "frontend", "out", "favicon.ico"),
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.webContents.session.clearCache();

  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.webContents.on("did-fail-load", () => {
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
      }
    }, 1200);
  });

  mainWindow.once("ready-to-show", () => {
    // Đóng cửa sổ Splash Screen và mở cửa sổ chính
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  createSplashWindow();

  try {
    const pyPath = await prepareRuntimeEnvironment();
    updateSplashProgress(98, "Đang kết nối giao diện Studio Mini...", "Khởi chạy máy chủ nội bộ");
    const backendOk = await startBackendServer(pyPath);
    if (!backendOk) {
      updateSplashProgress(0, "Không thể kết nối Backend!", "Vui lòng khởi động lại ứng dụng");
      return;
    }

    updateSplashProgress(100, "Sẵn sàng!", "Chào mừng bạn đến với Studio Mini");
    createMainWindow();
    setupAutoUpdater();
  } catch (err) {
    console.error("[App] Startup error:", err);
  }
});

function setupAutoUpdater() {
  if (!app.isPackaged) {
    console.log("[AutoUpdater] Running in dev mode, skipping auto update check.");
    return;
  }

  try {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("update-available", (info) => {
      console.log("[AutoUpdater] Found new update:", info.version);
    });

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[AutoUpdater] Update downloaded successfully:", info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Cập nhật Studio Mini",
          message: `Đã có bản cập nhật mới v${info.version}!`,
          detail: "Bản cập nhật đã được tự động tải về hoàn tất. Bạn có muốn khởi động lại app ngay để cập nhật không?",
          buttons: ["Khởi động lại ngay", "Để sau"],
          defaultId: 0,
          cancelId: 1
        }).then((result) => {
          if (result.response === 0) {
            autoUpdater.quitAndInstall(false, true);
          }
        });
      }
    });

    autoUpdater.on("error", (err) => {
      console.warn("[AutoUpdater] Check update notice (non-fatal):", err ? err.message : "");
    });

    // Sau khi mở app 6 giây, tự động quét tìm bản cập nhật từ xa trên GitHub
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    }, 6000);
  } catch (e) {
    console.warn("[AutoUpdater] Setup error:", e);
  }
}

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (pythonProcess) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /pid ${pythonProcess.pid} /f /t`);
      } else {
        pythonProcess.kill();
      }
    } catch (e) {}
  }
  app.quit();
});
