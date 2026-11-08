@echo off
chcp 65001 >nul
title 雀境 - 3D 麻将馆
cd /d "%~dp0"
if exist "release\0.3.4\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\0.3.4\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
if exist "release\0.3.3\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\0.3.3\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
if exist "release\0.3.2\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\0.3.2\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
if exist "release\0.3.1\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\0.3.1\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
if exist "release\0.3.0\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\0.3.0\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
if exist "release\0.2.1\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\0.2.1\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
if exist "release\Jakukyo-win32-x64\Jakukyo.exe" (
  start "" "%~dp0release\Jakukyo-win32-x64\Jakukyo.exe"
  exit /b 0
)
where node >nul 2>nul
if errorlevel 1 (
  echo 未找到 Node.js。请先安装 Node.js 22 或更新版本，再启动游戏。
  pause
  exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 未找到 npm。请检查 Node.js 的安装是否完整。
  pause
  exit /b 1
)
if not exist "node_modules\vite\bin\vite.js" (
  echo 尚未安装项目依赖。请先在此目录运行 npm install。
  echo 安装依赖之后，游戏可以完全离线运行。
  pause
  exit /b 1
)
echo 正在启动雀境，浏览器即将打开 http://127.0.0.1:5173/
echo 游戏运行期间请保持此窗口打开。关闭窗口即可停止本地服务。
call npm.cmd run dev -- --open
if errorlevel 1 (
  echo.
  echo 启动失败。如果已有游戏窗口，请直接访问 http://127.0.0.1:5173/
  pause
)
