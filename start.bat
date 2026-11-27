@echo off
setlocal
cd /d "%~dp0"
set PORT=8080
set URL=http://127.0.0.1:%PORT%/

echo.
echo  Kennel Booking — local server
echo  Folder: %CD%
echo  URL:    %URL%
echo.

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "%URL%"
  echo Starting with Python (py)...
  py -m http.server %PORT%
  goto :eof
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "%URL%"
  echo Starting with Python...
  python -m http.server %PORT%
  goto :eof
)

where node >nul 2>&1
if %ERRORLEVEL%==0 (
  start "" "%URL%"
  echo Starting with Node npx serve...
  npx --yes serve -l %PORT% .
  goto :eof
)

echo ERROR: need Python 3 or Node.js installed.
echo Install one of them, then run start.bat again.
echo.
pause
