const { app, BrowserWindow } = require("electron");
const path = require("path");
const http = require("http");
const { spawn, execSync } = require("child_process");

let mainWindow = null;
let pythonProcess = null;
const PORT = 8000;
const HEALTH_URL = `http://127.0.0.1:${PORT}/api/health`;

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

function getPythonPath() {
  const fs = require("fs");
  const localAppData = process.env.LOCALAPPDATA || "";
  const py311 = path.join(localAppData, "Programs", "Python", "Python311", "python.exe");
  if (fs.existsSync(py311)) {
    return py311;
  }
  return "python";
}

function startBackendServer() {
  return new Promise(async (resolve) => {
    const isAlreadyRunning = await checkBackendReady(1500);
    if (isAlreadyRunning) {
      console.log("[Electron] Backend is already running on port 8000.");
      return resolve(true);
    }

    console.log("[Electron] Starting Python FastAPI backend...");
    const pyPath = getPythonPath();
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

    const ready = await checkBackendReady(25000);
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

  // Luôn xóa cache để giao diện và kịch bản luôn mới nhất
  mainWindow.webContents.session.clearCache();

  // Cho phép phím F5 hoặc Ctrl+R để tải lại trang
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F5" || (input.control && input.key.toLowerCase() === "r")) {
      mainWindow.webContents.reloadIgnoringCache();
    }
  });

  // Tải giao diện ứng dụng Studio Mini
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  // Tự động tải lại nếu lần đầu chưa kết nối được
  mainWindow.webContents.on("did-fail-load", () => {
    console.log("[Electron] Backend loading, retrying in 1s...");
    setTimeout(() => {
      if (mainWindow) {
        mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
      }
    }, 1200);
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}


app.whenReady().then(async () => {
  await startBackendServer();
  createMainWindow();

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
    } catch (e) {
      // Ignored
    }
  }
  app.quit();
});
