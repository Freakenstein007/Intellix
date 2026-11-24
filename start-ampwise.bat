@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 goto :node_missing

if exist ".venv\Scripts\python.exe" goto :venv_ready
where py >nul 2>&1
if errorlevel 1 goto :use_python
py -3 -m venv .venv
if errorlevel 1 goto :failed
goto :venv_ready

:use_python
where python >nul 2>&1
if errorlevel 1 goto :python_missing
python -m venv .venv
if errorlevel 1 goto :failed

:venv_ready
echo Installing or checking backend packages...
".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
if errorlevel 1 goto :failed

if exist "frontend\node_modules\.bin\vite.cmd" goto :start_servers
echo Installing frontend packages (first launch only)...
call npm install --prefix frontend
if errorlevel 1 goto :failed

:start_servers
echo Starting AMPWISE backend and frontend...
start "AMPWISE Backend" /D "%~dp0backend" cmd /k ""%~dp0.venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 9000"
start "AMPWISE Frontend" /D "%~dp0frontend" cmd /k "npm run dev"
echo Keep the two AMPWISE server windows open while using the app.
echo Opening http://localhost:5173/book in a few seconds...
timeout /t 7 /nobreak >nul
start "" "http://localhost:5173/book"
exit /b 0

:node_missing
echo Node.js 20 or newer and npm are required. Install Node.js, then run this file again.
goto :failed

:python_missing
echo Python 3.11 or newer is required. Install Python, then run this file again.
goto :failed

:failed
echo AMPWISE could not start. Read the message above, fix that issue, and run this file again.
pause
exit /b 1
