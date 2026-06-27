@echo off
setlocal enabledelayedexpansion
title Atlas Studio  -  NotebookLM Folderizer Launcher
color 0D
cd /d "%~dp0"

:: ====================================================================
::  NotebookLM Folderizer / Atlas Studio  -  guided launcher (ADR-0016)
::  Pure batch, no dependencies. Auto-finds Node (or downloads portable).
:: ====================================================================

:menu
cls
call :banner
echo.
echo    ==================================================================
echo       MAIN MENU      pick a number and press Enter
echo    ==================================================================
echo.
echo       [1]  Launch Atlas Studio          the desktop app
echo       [2]  Start server + open Atlas     in your web browser
echo       [3]  Load extension into Chrome    organize your notebooks
echo.
echo       [4]  Build browser packages        Chrome / Edge / Firefox
echo       [5]  Build desktop installer       Windows .exe
echo       [6]  Run the test suite
echo.
echo       [7]  Help and API reference
echo       [0]  Exit
echo.
set "choice="
set /p "choice=    Your choice:  "
:: Keep only the first character so a stray space/CR never breaks routing.
if defined choice set "choice=%choice:~0,1%"
if "%choice%"=="1" goto launch_desktop
if "%choice%"=="2" goto start_server
if "%choice%"=="3" goto load_extension
if "%choice%"=="4" goto build_packages
if "%choice%"=="5" goto build_installer
if "%choice%"=="6" goto run_tests
if "%choice%"=="7" goto help
if "%choice%"=="0" goto bye
goto menu

:: ------------------------------------------------------------------ 1
:launch_desktop
cls
call :banner
echo.
echo    [*] Launching Atlas Studio...
echo.
if exist "dist-desktop\win-unpacked\Atlas Studio.exe" (
  echo    [+] Found the built app. Opening it now.
  start "" "dist-desktop\win-unpacked\Atlas Studio.exe"
  goto done
)
call :ensure_node || goto done
call :ensure_deps || goto done
if exist "node_modules\.bin\electron.cmd" (
  echo    [+] Starting the desktop app in dev mode ^(npm run desktop^).
  start "Atlas Studio" cmd /c "npm run desktop"
  goto done
)
echo    [!] The desktop app is not built yet.
echo        Choose [5] to build the installer, or [2] to use the browser.
goto done

:: ------------------------------------------------------------------ 2
:start_server
cls
call :banner
call :ensure_node || goto done
call :ensure_deps || goto done
echo.
echo    [*] Freeing port 3000 if in use...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do taskkill /f /pid %%a >nul 2>&1
echo    [*] Starting the companion server on http://localhost:3000 ...
start "NotebookLM Companion Server" cmd /c "node server.js"
ping -n 3 127.0.0.1 >nul
echo    [+] Opening Atlas in your default browser...
start "" "http://localhost:3000/atlas/"
echo.
echo    Keep the server window open while you use Atlas.
goto done

:: ------------------------------------------------------------------ 3
:load_extension
cls
call :banner
set "CHROME="
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe"
echo.
if not defined CHROME (
  echo    [!] Chrome was not found in the usual places.
  echo        Open chrome://extensions, turn on Developer mode,
  echo        click "Load unpacked" and pick this folder:
  echo        %~dp0extension
  goto done
)
echo    [+] Launching Chrome with the Folderizer extension loaded...
start "" "!CHROME!" --user-data-dir="%TEMP%\nlm-chrome-profile" --load-extension="%~dp0extension" "https://notebooklm.google.com/"
goto done

:: ------------------------------------------------------------------ 4
:build_packages
cls
call :banner
call :ensure_node || goto done
call :ensure_deps || goto done
echo.
echo    [*] Building Chrome / Edge / Firefox packages into dist\ ...
call npm run package
echo.
echo    [+] Done. Open the dist\ folder to find the zips.
start "" "%~dp0dist" 2>nul
goto done

:: ------------------------------------------------------------------ 5
:build_installer
cls
call :banner
call :ensure_node || goto done
call :ensure_deps || goto done
echo.
echo    [*] Building the Windows desktop installer ^(this can take a few minutes^)...
call node tools\build-icon.js
call npm run dist:win
echo.
echo    [+] Done. Look in dist-desktop\ for "Atlas Studio Setup *.exe".
start "" "%~dp0dist-desktop" 2>nul
goto done

:: ------------------------------------------------------------------ 6
:run_tests
cls
call :banner
call :ensure_node || goto done
call :ensure_deps || goto done
echo.
echo    [*] Running the test suite...
echo.
call npm test
goto done

:: ------------------------------------------------------------------ 7
:help
cls
call :banner
echo.
echo    QUICK START
echo    -----------
echo      Easiest:   [1] Launch Atlas Studio  (or [5] to build it first)
echo      Browser:   [2] Start server + open Atlas
echo      Organize:  [3] Load extension into Chrome
echo.
echo    COMPANION SERVER API  (http://localhost:3000)
echo    ---------------------------------------------
echo      GET  /api/folders                       saved folder structure
echo      GET  /api/notebooks                     your notebooks (via extension)
echo      GET  /api/graph[?format=graphml]        knowledge graph export
echo      POST /api/notebooks/:id/chat            stream a chat (SSE)
echo      POST /api/notebooks/:id/generate-product  build a product
echo      GET  /api/folders/:id/podcast/plan      plan a podcast series
echo      GET  /api/folders/:id/study-pack/plan   plan a study pack
echo      POST /api/watch                         watch mode (auto-regen)
echo.
echo    Full docs: README.md
goto done

:: ------------------------------------------------------------------
:: Helpers
:: ------------------------------------------------------------------
:ensure_node
where node >nul 2>&1 && exit /b 0
set "PB=%~dp0bin\node\node-v20.11.0-win-x64"
if exist "!PB!\node.exe" ( set "PATH=!PB!;%PATH%" & exit /b 0 )
echo    [*] Node.js not found. Downloading a portable copy (one time)...
if not exist "%~dp0bin\node" mkdir "%~dp0bin\node"
powershell -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/node-v20.11.0-win-x64.zip' -OutFile '%~dp0bin\node.zip'"
if errorlevel 1 ( echo    [-] Download failed. Check your internet connection. & exit /b 1 )
powershell -Command "Expand-Archive -Path '%~dp0bin\node.zip' -DestinationPath '%~dp0bin\node'"
del "%~dp0bin\node.zip" >nul 2>&1
set "PATH=!PB!;%PATH%"
where node >nul 2>&1 && exit /b 0
echo    [-] Could not configure Node.js automatically.
exit /b 1

:ensure_deps
if exist "%~dp0node_modules" exit /b 0
echo    [*] Installing dependencies (one time)...
call npm install
if errorlevel 1 ( echo    [-] npm install failed. & exit /b 1 )
exit /b 0

:banner
echo.
echo         #     ####### #          #     #####
echo        # #       #    #         # #   #     #
echo       #   #      #    #        #   #  #
echo      #     #     #    #       #     #  #####
echo      #######     #    #       #######       #
echo      #     #     #    #       #     # #     #
echo      #     #     #    ####### #     #  #####
echo.
echo            S T U D I O    *    .    *    .
echo       Research and Podcast Studio for NotebookLM
exit /b 0

:done
echo.
echo    ------------------------------------------------------------------
set "again="
set /p "again=    Press Enter to return to the menu, or type Q to quit:  "
if defined again set "again=%again:~0,1%"
if /i "%again%"=="Q" goto bye
goto menu

:bye
cls
call :banner
echo.
echo       Thanks for using Atlas Studio.  See you next time.
echo.
timeout /t 2 >nul
endlocal
exit /b 0
