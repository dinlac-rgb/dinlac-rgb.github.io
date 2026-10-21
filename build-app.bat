@echo off
REM ---------------------------------------------------------------------------
REM  BizPulse - one click: check the workspace, prepare it, validate it, then run it.
REM
REM    build-app.bat               everything below, then a menu:
REM                                  1 Start BizPulse in development (live reload)
REM                                  2 Start the built app (as users will run it)
REM                                  3 Build the Windows installer (build-installer.bat)
REM                                  4 Exit
REM    build-app.bat check         validation only (layout, install, type-check, tests, build), no menu
REM    build-app.bat dev           validate, then start in development
REM    build-app.bat start         validate, then start the built app
REM    build-app.bat installer     validate, then build the installer of the active edition
REM
REM  Steps (it stops at the first failure and says which one):
REM    [1] workspace layout   check-layout.bat (every required file present, nothing nested wrongly)
REM    [2] Node.js 20+        node and npm on the PATH
REM    [3] dependencies       npm install (skipped when node_modules is complete; set FORCE_INSTALL=1)
REM    [4] database engine    prisma generate + the empty template database
REM    [5] type-check         npm run typecheck
REM    [6] tests              npm test (25 suites)
REM    [7] build              npm run build (renderer + main process)
REM
REM  Run it from a normal Command Prompt in the workspace folder (next to app\ and editions\).
REM  The edition is the one selected in app\src\edition\active.json (BizPulse Pro by default).
REM ---------------------------------------------------------------------------
setlocal EnableExtensions
set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "MODE=%~1"
if /i not "%MODE%"=="" if /i not "%MODE%"=="check" if /i not "%MODE%"=="dev" if /i not "%MODE%"=="start" if /i not "%MODE%"=="installer" (
  echo Unknown option "%MODE%". Use: build-app.bat [check ^| dev ^| start ^| installer]
  exit /b 1
)
title BizPulse - build and validate

echo.
echo [1/7] Checking the workspace layout...
if not exist "%ROOT%\check-layout.bat" (echo check-layout.bat is missing from %ROOT%. & goto :fail)
call "%ROOT%\check-layout.bat" >"%TEMP%\bizpulse-layout.txt" 2>&1
if errorlevel 1 (
  type "%TEMP%\bizpulse-layout.txt"
  echo.
  echo The workspace is incomplete - see the MISSING lines above.
  goto :fail
)
echo       ok - all required files are present.

echo.
echo [2/7] Checking Node.js...
where node >nul 2>nul || (echo Node.js is not installed. Install Node.js 20 LTS from https://nodejs.org and run again. & goto :fail)
where npm >nul 2>nul || (echo npm was not found. Reinstall Node.js 20 LTS from https://nodejs.org. & goto :fail)
for /f "usebackq delims=" %%v in (`node -p "process.versions.node"`) do set "NODEVER=%%v"
for /f "usebackq delims=" %%v in (`node -p "Number(process.versions.node.split('.')[0]) >= 20 ? 'ok' : 'old'"`) do set "NODEOK=%%v"
if not "%NODEOK%"=="ok" (echo Node.js %NODEVER% is too old. Install Node.js 20 LTS from https://nodejs.org. & goto :fail)
echo       ok - Node.js %NODEVER%

cd /d "%ROOT%\app" || goto :fail
for /f "usebackq delims=" %%a in (`node scripts\use-edition.js --current`) do set "EDITION=%%a"
echo       edition: %EDITION%

echo.
echo [3/7] Dependencies...
set "NEED_INSTALL="
if "%FORCE_INSTALL%"=="1" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\electron.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\vite.cmd" set "NEED_INSTALL=1"
if not exist "node_modules\@prisma\client\package.json" set "NEED_INSTALL=1"
if not exist "node_modules\.bin\tsx.cmd" set "NEED_INSTALL=1"
if defined NEED_INSTALL (
  echo       npm install - the first run takes a few minutes...
  call npm install || goto :fail
) else (
  echo       ok - node_modules is complete. Set FORCE_INSTALL=1 to reinstall.
)

echo.
echo [4/7] Database engine and template...
taskkill /im BizPulse.exe /f >nul 2>nul
taskkill /im electron.exe /f >nul 2>nul
call npx prisma generate >"%TEMP%\bizpulse-prisma.txt" 2>&1
if errorlevel 1 (
  type "%TEMP%\bizpulse-prisma.txt"
  echo.
  echo prisma generate failed. Usually another program holds query_engine-windows.dll.node:
  echo close BizPulse and any editor on this folder, add an antivirus exclusion for this folder, and run again.
  goto :fail
)
if not exist "node_modules\.prisma\client\default.js" (echo The Prisma client was not generated. & goto :fail)
call npm run db:template >"%TEMP%\bizpulse-template.txt" 2>&1
if errorlevel 1 (type "%TEMP%\bizpulse-template.txt" & echo Creating the database template failed. & goto :fail)
echo       ok - Prisma client, query engine and template database ready.

echo.
echo [5/7] Type-checking...
call npm run typecheck || goto :fail
echo       ok

echo.
echo [6/7] Running the tests...
call npm test >"%TEMP%\bizpulse-tests.txt" 2>&1
if errorlevel 1 (
  type "%TEMP%\bizpulse-tests.txt"
  echo.
  echo A test failed - see above. Nothing was started.
  goto :fail
)
for /f %%c in ('find /c " passed" ^< "%TEMP%\bizpulse-tests.txt"') do set "SUITES=%%c"
echo       ok - %SUITES% test suites passed (full log: %TEMP%\bizpulse-tests.txt)

echo.
echo [7/7] Building...
call npm run build || goto :fail
if not exist "dist\index.html" (echo The renderer build is missing dist\index.html. & goto :fail)
if not exist "dist-electron\server\bootstrap.js" (echo The main-process build is missing dist-electron\server\bootstrap.js. & goto :fail)
if exist "public\fonts\Playball-Regular.ttf" (
  echo       ok - built. Tagline font: Playball.
) else (
  echo       ok - built. NOTE: app\public\fonts\Playball-Regular.ttf is not there - the tagline uses Segoe Script.
)

echo.
echo ============================================================================
echo  All checks passed for %EDITION%.
echo ============================================================================
if /i "%MODE%"=="check" exit /b 0
if /i "%MODE%"=="dev" goto :dev
if /i "%MODE%"=="start" goto :start
if /i "%MODE%"=="installer" goto :installer

echo.
echo   1  Start BizPulse in development (live reload)
echo   2  Start the built app
echo   3  Build the Windows installer
echo   4  Exit
choice /c 1234 /n /m "Choose 1-4: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto :installer
if errorlevel 2 goto :start
goto :dev

:dev
echo.
echo Starting in development. Close the BizPulse window (or press Ctrl+C here) to stop.
call npm run dev
exit /b %errorlevel%

:start
echo.
echo Starting the built app. Your books: %APPDATA%\BizPulse
call npx electron .
exit /b %errorlevel%

:installer
for /f "usebackq delims=" %%a in (`node -p "require('./src/edition/active.json').folder"`) do set "FOLDER=%%a"
set SKIP_INSTALL=1
call "%ROOT%\build-installer.bat" %FOLDER%
set "RC=%errorlevel%"
if /i "%MODE%"=="" pause
exit /b %RC%

:fail
echo.
echo ============================================================================
echo  STOPPED - fix the first error above and run build-app.bat again.
echo ============================================================================
if /i "%MODE%"=="" pause
exit /b 1
