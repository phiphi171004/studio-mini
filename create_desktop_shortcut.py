"""
Tạo Shortcut của Studio Mini trực tiếp lên Màn hình chính (Desktop) của Windows.
"""

import os
import subprocess
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
TARGET_FILE = PROJECT_ROOT / "StudioMini.vbs"
ICON_FILE = PROJECT_ROOT / "frontend" / "out" / "favicon.ico"

def create_shortcut():
    powershell_cmd = f"""
    $Desktop = [Environment]::GetFolderPath('Desktop')
    $ShortcutPath = Join-Path $Desktop 'Studio Mini AI.lnk'
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
    $Shortcut.TargetPath = '{TARGET_FILE}'
    $Shortcut.WorkingDirectory = '{PROJECT_ROOT}'
    $Shortcut.Description = 'Studio Mini - AI Voice Dubbing Desktop'
    if (Test-Path '{ICON_FILE}') {{
        $Shortcut.IconLocation = '{ICON_FILE}'
    }}
    $Shortcut.Save()
    Write-Output "SAVED: $ShortcutPath"
    """

    res = subprocess.run(["powershell", "-NoProfile", "-Command", powershell_cmd], capture_output=True, text=True)
    if "SAVED:" in res.stdout:
        saved_path = res.stdout.strip().replace("SAVED:", "").strip()
        print(f"[Shortcut] Successfully created desktop shortcut: {saved_path}")
    else:
        print(f"[Shortcut] Output: {res.stdout.strip()} Error: {res.stderr.strip()}")

if __name__ == "__main__":
    create_shortcut()

