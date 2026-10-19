@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" scripts\launch.mjs
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 请先安装 Node.js 22.18 或更新版本：https://nodejs.org/
  ) else (
    node scripts\launch.mjs
  )
)
pause
