import uvicorn
import os
import sys

# Configure UTF-8 encoding for Windows console
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if __name__ == "__main__":
    # Add current directory and backend directory to sys.path
    curr_dir = os.path.abspath(os.path.dirname(__file__))
    sys.path.insert(0, curr_dir)
    sys.path.insert(0, os.path.join(curr_dir, "backend"))
    
    print("=" * 60)
    print("  STUDIO MINI - AI VOICE DUBBING BACKEND SERVER")
    print("  API URL: http://127.0.0.1:8000")
    print("  API Docs: http://127.0.0.1:8000/docs")
    print("  Database: storage/app.db")
    print("=" * 60)
    
    is_dev = "--dev" in sys.argv or os.getenv("ENV") == "development"
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=8000, reload=is_dev)

