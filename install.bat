@echo off
setlocal enabledelayedexpansion

echo ============================================================
echo   HaymGraph - Adobe After Effects CEP Extension Installer
echo ============================================================
echo.

:: 1. Enable PlayerDebugMode in Windows Registry for CEP
echo [*] Enabling CEP Debug Mode in Windows Registry...
for %%v in (9 10 11 12 13 14 15) do (
    reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
)
echo [OK] PlayerDebugMode enabled.

:: 2. Create CEP Extensions Directory if not exists
set "EXT_DIR=%APPDATA%\Adobe\CEP\extensions"
if not exist "%EXT_DIR%" (
    mkdir "%EXT_DIR%"
)

:: 3. Target Directory
set "TARGET_DIR=%EXT_DIR%\HaymGraph"

:: Remove old junction or directory if it exists
if exist "%TARGET_DIR%" (
    echo [*] Removing previous installation...
    rmdir "%TARGET_DIR%" 2>nul
    if exist "%TARGET_DIR%" (
        rmdir /s /q "%TARGET_DIR%"
    )
)

:: 4. Install Extension Files
if "%1"=="--link" (
    echo [*] Linking extension to Adobe CEP directory...
    mklink /J "%TARGET_DIR%" "%~dp0" >nul 2>&1
) else (
    echo [*] Installing extension files to Adobe CEP directory...
    mkdir "%TARGET_DIR%" 2>nul
    xcopy "%~dp0*" "%TARGET_DIR%\" /E /I /H /Y >nul
)

echo.
echo ============================================================
echo   [SUCCESS] HaymGraph installed successfully!
echo   Location: %TARGET_DIR%
echo   In After Effects: Window -> Extensions -> HaymGraph
echo ============================================================
echo.
pause
