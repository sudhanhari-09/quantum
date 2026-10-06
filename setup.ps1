# QuantumSecure - one-shot setup for backend + frontend (Windows PowerShell)
# Usage:  powershell -ExecutionPolicy Bypass -File .\setup.ps1
# Skips steps that are already done, so it is safe to re-run.

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
if (-not $root) { $root = (Get-Location).Path }

Write-Host "=== QuantumSecure setup ===" -ForegroundColor Cyan

# ---------- Backend ----------
Write-Host "`n[1/6] Backend: virtualenv" -ForegroundColor Yellow
Push-Location (Join-Path $root "backend")
try {
    if (-not (Test-Path ".venv\Scripts\python.exe")) {
        py -m venv .venv
    } else { Write-Host "      .venv exists - skipping" }

    Write-Host "[2/6] Backend: dependencies" -ForegroundColor Yellow
    & ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt --quiet

    Write-Host "[3/6] Backend: .env" -ForegroundColor Yellow
    if (-not (Test-Path ".env")) {
        Copy-Item ".env.example" ".env"
        Write-Host "      Created .env - EDIT IT: set JWT_SECRET_KEY and QSC_MASTER_KEY"
        Write-Host "      Generate a master key with:"
        Write-Host '      .\.venv\Scripts\python.exe -c "import os,base64; print(base64.b64encode(os.urandom(32)).decode())"'
    } else { Write-Host "      .env exists - skipping" }

    Write-Host "[4/6] Backend: migrations" -ForegroundColor Yellow
    # Alembic logs INFO to stderr; relax EAP so PowerShell doesn't treat it as fatal.
    $ErrorActionPreference = "Continue"
    & ".\.venv\Scripts\alembic.exe" upgrade head
    $ErrorActionPreference = "Stop"
} finally { Pop-Location }

# ---------- Frontend ----------
Write-Host "`n[5/6] Frontend: dependencies" -ForegroundColor Yellow
Push-Location (Join-Path $root "frontend")
try {
    if (-not (Test-Path "node_modules")) { npm ci } else { Write-Host "      node_modules exists - skipping (run 'npm ci' to force reinstall)" }

    Write-Host "[6/6] Frontend: .env.development" -ForegroundColor Yellow
    if (-not (Test-Path ".env.development")) {
        Copy-Item ".env.example" ".env.development"
    } else { Write-Host "      .env.development exists - skipping" }
} finally { Pop-Location }

Write-Host "`n=== Setup complete. Start the apps: ===" -ForegroundColor Cyan
Write-Host "  Backend : cd backend;  .\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8000"
Write-Host "  Frontend: cd frontend; npm run dev"
Write-Host "  API docs: http://localhost:8000/docs   Frontend: http://localhost:5173"
