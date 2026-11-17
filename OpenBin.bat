@echo off
setlocal
set "ROOT=%~dp0"

rem --------------------------------------------- already running?
curl.exe -s -o nul http://localhost:5173/
if not errorlevel 1 (
  echo OpenBin is already running. Opening the browser...
  start "" http://localhost:5173
  pause
  exit /b 0
)

rem --------------------------------------------- preflight checks
if not exist "%ROOT%backend\venv\Scripts\python.exe" (
  echo [ERROR] Backend virtual environment not found.
  echo Run this once first:
  echo     cd backend
  echo     python -m venv venv
  echo     venv\Scripts\python.exe -m pip install -r requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist "%ROOT%frontend\node_modules" (
  echo [ERROR] Frontend dependencies not installed.
  echo Run this once first:
  echo     cd frontend
  echo     npm install
  echo.
  pause
  exit /b 1
)

rem --------------------------------------------- start both services
echo Starting OpenBin...
start "OpenBin - Backend"  /min /d "%ROOT%backend"  cmd /k "venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
start "OpenBin - Frontend" /min /d "%ROOT%frontend" cmd /k "npm run dev"

rem --------------------------------------------- wait until both answer, then open the browser
set /a tries=0
:wait
ping -n 3 127.0.0.1 >nul
curl.exe -s -o nul http://127.0.0.1:8000/api/settings
if errorlevel 1 goto retry
curl.exe -s -o nul http://localhost:5173/
if errorlevel 1 goto retry
goto ready

:retry
set /a tries+=1
if %tries% lss 25 goto wait
echo [WARN] A service did not answer in time. Opening the browser anyway.
echo        Check the "OpenBin - Backend" and "OpenBin - Frontend" windows for errors.

:ready
start "" http://localhost:5173

echo.
echo   OpenBin is up:
echo     Frontend : http://localhost:5173
echo     Backend  : http://127.0.0.1:8000
echo.
echo   To stop: close the "OpenBin - Backend" and "OpenBin - Frontend" windows.
echo   You can close this window now.
echo.
pause
exit /b 0
