# AGOS-Offline Windows PowerShell Launcher
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   AGOS-Offline Local AI Console Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1. Setup Backend Python Virtual Environment
$BackendDir = Join-Path $ScriptDir "backend"
$VenvDir = Join-Path $BackendDir "venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Host "[1/4] Creating Python virtual environment..." -ForegroundColor Yellow
    python -m venv $VenvDir
    & $PythonExe -m pip install --upgrade pip
    Write-Host "[1/4] Installing backend dependencies..." -ForegroundColor Yellow
    & $PythonExe -m pip install -r (Join-Path $BackendDir "requirements.txt")
} else {
    Write-Host "[1/4] Python virtual environment ready." -ForegroundColor Green
}

# 2. Setup Frontend Node Modules
$FrontendDir = Join-Path $ScriptDir "frontend"
if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
    Write-Host "[2/4] Installing frontend npm dependencies..." -ForegroundColor Yellow
    Push-Location $FrontendDir
    npm install
    Pop-Location
} else {
    Write-Host "[2/4] Frontend dependencies ready." -ForegroundColor Green
}

# 3. Start Backend Server
Write-Host "[3/4] Starting AGOS-Offline Backend (FastAPI on http://localhost:8000)..." -ForegroundColor Cyan
$BackendJob = Start-Process -FilePath $PythonExe -ArgumentList "-m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload" -WorkingDirectory $BackendDir -PassThru

Start-Sleep -Seconds 2

# 4. Start Frontend Console
Write-Host "[4/4] Starting AGOS-Offline Console (Vite on http://localhost:5173)..." -ForegroundColor Cyan
Push-Location $FrontendDir
Start-Process "cmd.exe" -ArgumentList "/c npm run dev" -WorkingDirectory $FrontendDir

Start-Sleep -Seconds 2
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "AGOS-Offline is now running!" -ForegroundColor Green
Write-Host "  - Operator Console: http://localhost:5173" -ForegroundColor White
Write-Host "  - Backend API & Docs: http://localhost:8000/docs" -ForegroundColor White
Write-Host "  - WebSocket Stream: ws://localhost:8000/ws" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C or close this window to exit." -ForegroundColor Gray

try {
    Wait-Process -Id $BackendJob.Id
} finally {
    if (-not $BackendJob.HasExited) {
        Stop-Process -Id $BackendJob.Id -Force
    }
}
