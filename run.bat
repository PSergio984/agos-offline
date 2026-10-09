@echo off
setlocal enabledelayedexpansion

echo ========================================
echo    AGOS-Offline Local AI Console Launcher
echo ========================================

set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

set "BACKEND_DIR=%SCRIPT_DIR%backend"
set "FRONTEND_DIR=%SCRIPT_DIR%frontend"
set "PYTHON_EXE=%BACKEND_DIR%\venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo [1/4] Creating Python virtual environment...
    python -m venv "%BACKEND_DIR%\venv"
    "%BACKEND_DIR%\venv\Scripts\pip.exe" install --upgrade pip
    echo [1/4] Installing backend dependencies...
    "%BACKEND_DIR%\venv\Scripts\pip.exe" install -r "%BACKEND_DIR%\requirements.txt"
) else (
    echo [1/4] Python virtual environment ready.
)

if not exist "%FRONTEND_DIR%\node_modules" (
    echo [2/4] Installing frontend npm dependencies...
    cd /d "%FRONTEND_DIR%"
    call npm install
    cd /d "%SCRIPT_DIR%"
) else (
    echo [2/4] Frontend dependencies ready.
)

echo [3/4] Starting AGOS-Offline Backend (FastAPI on http://localhost:8000)...
start "AGOS Backend" "%PYTHON_EXE%" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

timeout /t 2 /nobreak >nul

echo [4/4] Starting AGOS-Offline Console (Vite on http://localhost:5173)...
cd /d "%FRONTEND_DIR%"
start "AGOS Console" cmd /c "npm run dev"

timeout /t 2 /nobreak >nul
start http://localhost:5173

echo.
echo AGOS-Offline is running!
echo   - Operator Console: http://localhost:5173
echo   - Backend API Docs: http://localhost:8000/docs
echo.
pause
