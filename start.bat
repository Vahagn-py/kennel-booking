@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set PORT=8080
set URL=http://127.0.0.1:%PORT%/

echo.
echo  Kennel Booking — local server
echo  Folder: %CD%
echo  URL:    %URL%
echo.

REM Prefer python, then py, then node
set "SERVER="
where python >nul 2>&1 && set "SERVER=python"
if not defined SERVER where py >nul 2>&1 && set "SERVER=py"
if not defined SERVER where node >nul 2>&1 && set "SERVER=node"

if not defined SERVER (
  echo ERROR: need Python 3 or Node.js installed.
  echo Install one of them, then run start.bat again.
  echo.
  pause
  exit /b 1
)

REM Open browser after the server has a moment to bind
start "" cmd /c "timeout /t 2 /nobreak >nul & start \"\" \"%URL%\""

echo Starting with %SERVER% ...
echo Keep this window open while you use the app.
echo Close this window to stop the server.
echo.

if /I "%SERVER%"=="node" (
  npx --yes serve -l %PORT% .
) else if /I "%SERVER%"=="py" (
  py -m http.server %PORT% --bind 127.0.0.1
) else (
  python -m http.server %PORT% --bind 127.0.0.1
)

echo.
echo Server stopped.
pause
