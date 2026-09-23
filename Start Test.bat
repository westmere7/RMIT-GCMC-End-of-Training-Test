@echo off
cd /d "%~dp0"
rem With a .env (Supabase keys) and Node installed: live data, same as the Vercel site.
rem Otherwise: the offline Python server that reads and writes data\questions.json.
where node >nul 2>nul
if %errorlevel%==0 if exist ".env" (
  start "" "http://localhost:8765/"
  node dev-server.js
  pause
  exit /b
)
start "" "http://localhost:8765/"
python server.py
pause
