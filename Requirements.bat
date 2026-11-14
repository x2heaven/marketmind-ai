@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 (
    echo [FAIL] Could not open the MarketMind AI project folder.
    if /i not "%~1"=="--quick" if /i not "%~1"=="--no-pause" pause
    exit /b 1
)

set "CHECK_RESULT=1"
node --version >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Node.js is missing or unavailable on PATH. Install Node.js 22.13 or newer.
    echo        https://nodejs.org/en/download
    goto done
)
if not exist "scripts\check-requirements.mjs" (
    echo [FAIL] Project files are missing. Extract the entire ZIP before running this check.
    goto done
)

if /i "%~1"=="--quick" (
    node scripts\check-requirements.mjs --quick
) else (
    node scripts\check-requirements.mjs
)
set "CHECK_RESULT=%errorlevel%"

:done
echo.
if /i not "%~1"=="--quick" if /i not "%~1"=="--no-pause" pause
popd
exit /b %CHECK_RESULT%
