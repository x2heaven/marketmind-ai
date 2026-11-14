@echo off
setlocal
pushd "%~dp0"
if errorlevel 1 (
    echo Could not open the MarketMind AI project folder.
    pause
    exit /b 1
)

node -e "process.exit(Number(process.versions.node.split('.')[0]) < 22 ? 1 : 0)" >nul 2>&1
if errorlevel 1 (
    echo MarketMind AI needs Node.js 22 or newer on PATH.
    echo Install Node.js and open this file again.
    goto failed
)

echo Building MarketMind AI...
node scripts\build.mjs
if errorlevel 1 goto failed

echo Starting the local server. Keep this window open while using the site.
if /i "%~1"=="--no-open" (
    node scripts\preview.mjs
) else (
    node scripts\preview.mjs --open
)
if errorlevel 1 goto failed

popd
exit /b 0

:failed
echo.
echo MarketMind AI could not start. See the message above.
pause
popd
exit /b 1
