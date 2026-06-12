@echo off
SETLOCAL EnableDelayedExpansion
title "NotebookLM Folderizer Setup & Launcher"

:: Navigate to script directory
cd /d "%~dp0"

echo ====================================================
echo   NotebookLM Folderizer Automated Launcher
echo ====================================================
echo.

:: 1. Check Node.js and NPM status
set "NODE_CMD=node"
set "NPM_CMD=npm"
set "PORTABLE_DIR=%~dp0bin\node"

where node >nul 2>&1
if %ERRORLEVEL% equ 0 (
  echo [+] Global Node.js installation detected.
  goto :install_deps
)

:: If global Node.js is missing, look for local portable node
set "PORTABLE_BIN_DIR=%~dp0bin\node\node-v20.11.0-win-x64"
set "PORTABLE_NODE=%PORTABLE_BIN_DIR%\node.exe"

if exist "!PORTABLE_NODE!" (
  echo [+] Local portable Node.js runtime detected.
  set "PATH=!PORTABLE_BIN_DIR!;%PATH%"
  goto :install_deps
)

echo [-] Node.js is not installed globally or locally on your system.
echo [*] Downloading portable Node.js runtime...
if not exist "%~dp0bin" mkdir "%~dp0bin"
if not exist "!PORTABLE_DIR!" mkdir "!PORTABLE_DIR!"

:: Download using powershell
echo [1/3] Downloading Node.js v20.11.0 x64 standalone...
powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip' -OutFile '%~dp0bin\node.zip'"
if %ERRORLEVEL% neq 0 (
  echo [-] Error: Failed to download Node.js. Check your internet connection.
  pause
  exit /b 1
)

echo [2/3] Extracting archive...
powershell -Command "Expand-Archive -Path '%~dp0bin\node.zip' -DestinationPath '!PORTABLE_DIR!'"
if %ERRORLEVEL% neq 0 (
  echo [-] Error: Failed to extract zip file.
  pause
  exit /b 1
)

echo [3/3] Cleaning up temporary files...
del "%~dp0bin\node.zip"

:: Add portable node to path
set "PATH=!PORTABLE_BIN_DIR!;%PATH%"
echo [+] Portable Node.js configured successfully.

:install_deps
:: 2. Install node dependencies if node_modules is missing
if not exist "%~dp0node_modules" (
  echo.
  echo [*] Installing NPM package dependencies...
  call npm install
  if %ERRORLEVEL% neq 0 (
    echo [-] Error: NPM dependency installation failed.
    pause
    exit /b 1
  )
  echo [+] Dependencies installed successfully.
) else (
  echo [+] Dependencies are already configured.
)

:: 3. Kill any previously running instance on port 3000 (optional but helpful)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
  taskkill /f /pid %%a >nul 2>&1
)

:: 4. Start Companion Server in background
echo.
echo [*] Starting NotebookLM Companion Server on port 3000...
start "NotebookLM Companion Server" cmd /c "node server.js"
ping -n 3 127.0.0.1 >nul

:: 5. Locate Google Chrome
set "CHROME_PATH="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
  set "CHROME_PATH=%LocalAppData%\Google\Chrome\Application\chrome.exe"
)

:: 6. Launch Chrome with Extension Loaded
echo.
if not defined CHROME_PATH (
  echo [-] WARNING: Google Chrome was not found in standard installation paths.
  echo [*] Please open your browser manually, navigate to:
  echo     chrome://extensions/
  echo [*] Turn on "Developer mode" and click "Load unpacked" and select:
  echo     %~dp0extension
) else (
  echo [+] Google Chrome found.
  echo [*] Launching Chrome with Folderizer Extension loaded...
  
  set "EXT_PATH=%~dp0extension"
  start "" "!CHROME_PATH!" --user-data-dir="%TEMP%\nlm-chrome-profile" --load-extension="!EXT_PATH!" "https://notebooklm.google.com/"
)


echo.
echo ====================================================
echo   Startup completed.
echo   Keep this setup command window open to keep the
echo   companion server running.
echo ====================================================
echo.
pause

