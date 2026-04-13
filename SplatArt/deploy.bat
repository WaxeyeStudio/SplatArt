@echo off
echo =======================================
echo 🚀 BUILDING SPLATART FOR PRODUCTION...
echo =======================================
call npm run build

:: Check if the build failed
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ BUILD FAILED! Aborting deployment.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo =======================================
echo 🌐 DEPLOYING TO GITHUB PAGES...
echo =======================================
call npm run deploy

:: Check if the deployment failed
if %ERRORLEVEL% neq 0 (
    echo.
    echo ❌ DEPLOYMENT FAILED!
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ✅ SUCCESS! Your updates have been pushed to GitHub!
echo (Remember, it takes about 60 seconds for GitHub to update the live link)
echo.
pause