@echo off
setlocal
set "ROOT=%~dp0"

rem --------------------------------------------- already running?
curl.exe -s -o nul http://localhost:5555/
if not errorlevel 1 (
  echo OpenBin is already running. Opening the browser...
  start "" http://localhost:5555
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

rem --------------------------------------------- start BOTH in THIS window
echo Starting OpenBin...
echo   Backend  : http://127.0.0.1:8000
echo   Frontend : http://localhost:5555
echo.
echo   Both services run in this same window.
echo   Press Ctrl+C (or close this window) to stop everything.
echo.

pushd "%ROOT%backend"
start "OpenBin backend"  /b cmd /c "venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000"
popd

pushd "%ROOT%frontend"
start "OpenBin frontend" /b cmd /c "npm run dev"
popd

rem --------------------------------------------- wait until both answer
set /a tries=0
:wait
ping -n 2 127.0.0.1 >nul
curl.exe -s -o nul http://127.0.0.1:8000/api/settings
if errorlevel 1 goto retry
curl.exe -s -o nul http://localhost:5555/
if errorlevel 1 goto retry
goto ready

:retry
set /a tries+=1
if %tries% lss 30 goto wait
echo [WARN] A service did not answer in time. Opening the browser anyway.
echo        Scroll up in this window to see which one failed.

:ready
start "" http://localhost:5555
echo.
echo   OpenBin is up. You can close this window any time to stop it.
echo.

rem --------------------------------------------- keep the window alive
ping -t 127.0.0.1 >nul
