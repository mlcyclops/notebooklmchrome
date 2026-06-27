@echo off
setlocal enabledelayedexpansion
title Atlas Studio  -  Desktop Installer Builder
color 0D
cd /d "%~dp0"

cls
echo.
echo      ____  _   _ ___ _    ____      _    ____  ____
echo     ^| __ )^| ^| ^| ^|_ _^| ^|  ^|  _ \    / \  ^|  _ \^|  _ \
echo     ^|  _ \^| ^| ^| ^|^| ^|^| ^|  ^| ^| ^| ^|  / _ \ ^| ^|_) ^| ^| ^| ^|
echo     ^| ^|_) ^| ^|_^| ^|^| ^|^| ^|__^| ^|_^| ^| / ___ \^|  __/^| ^|_^| ^|
echo     ^|____/ \___/^|___^|_____^|____/ /_/   \_\_^|   ^|____/
echo.
echo            Building the Atlas Studio desktop installer
echo     ==================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo    [-] Node.js is required to build the installer.
  echo        Install Node from https://nodejs.org and run this again,
  echo        or use run.bat which can fetch a portable copy.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo    [1/3] Installing dependencies ^(one time^)...
  call npm install || ( echo    [-] npm install failed. & pause & exit /b 1 )
) else (
  echo    [1/3] Dependencies already installed.
)

echo    [2/3] Generating the app icon...
call node tools\build-icon.js

echo    [3/3] Packaging with electron-builder ^(this can take a few minutes^)...
call npm run dist:win
if errorlevel 1 ( echo    [-] Build failed. See the output above. & pause & exit /b 1 )

echo.
echo     ==================================================================
echo       [+] SUCCESS.  Your installer is in dist-desktop\
echo           Look for:  Atlas Studio Setup ^<version^>.exe
echo     ==================================================================
echo.
start "" "%~dp0dist-desktop" 2>nul
pause
endlocal
exit /b 0
