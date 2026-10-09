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

if exist "%PYTHON_EXE%" (
    set "RUN_PYTHON=%PYTHON_EXE%"
    echo [1/4] Using Python venv.
) else (
    where python >nul 2>&1
    if !errorlevel! equ 0 (
        set "RUN_PYTHON=python"
        echo [1/4] Using system Python environment.
    ) else (
        echo [1/4] Python not found! Please install Python 3.10+
        pause
        exit /b 1
    )
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
start "AGOS Backend" /d "%BACKEND_DIR%" "%RUN_PYTHON%" -m uvicorn app.main:app --host 0.0.0.0 --port 8000

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
