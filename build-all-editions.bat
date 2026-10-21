@echo off
REM ---------------------------------------------------------------------------
REM  BizPulse - build all five product editions, one after another (Inno Setup).
REM  Output: installer_output\*.exe, and a copy in editions\<Folder>\release\ for each.
REM  Leaves the code on BizPulse_Pro afterwards (the default for "npm run dev").
REM ---------------------------------------------------------------------------
setlocal
where node >nul 2>nul || (echo Node.js is not installed. Install Node.js 20 LTS from nodejs.org and run again. & exit /b 1)
cd /d "%~dp0app" || exit /b 1
echo Installing dependencies once...
call npm install || goto :fail
set SKIP_INSTALL=1
for %%e in (BizPulse_Pro BizPulse_Standard BizPulse_Lite BizPulse_Billing BizPulse_Voice_Express) do (
  echo.
  echo ===================== %%e =====================
  call "%~dp0build-edition.bat" %%e || goto :fail
)
cd /d "%~dp0app"
call node scripts\use-edition.js BizPulse_Pro >nul
echo.
echo All five editions built. Installers: %~dp0installer_output
exit /b 0

:fail
cd /d "%~dp0app" 2>nul && call node scripts\use-edition.js BizPulse_Pro >nul 2>nul
echo.
echo BUILD FAILED - see the first error above. The code is back on BizPulse_Pro.
exit /b 1
