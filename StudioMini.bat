@echo off
cd /d "%~dp0"
echo ========================================================
echo   STUDIO MINI - NATIVE DESKTOP APP (ELECTRON)
echo ========================================================
echo Starting Studio Mini native window...
echo.

call "node_modules\.bin\electron.cmd" .
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to start Electron app. Trying pnpm exec electron...
    pnpm exec electron .
    pause
)
