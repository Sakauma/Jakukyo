@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 使用现有 WSL ubuntu2004 环境构建 Windows 离线便携版。
echo 首次打包需下载项目构建依赖和 Electron 运行时。
wsl.exe -d ubuntu2004 -- bash /mnt/d/unfixed/majiang/scripts/package-wsl.sh
if errorlevel 1 (
  echo 打包失败，请查看上面的错误信息。
  pause
  exit /b 1
)
echo 打包完成，文件位于 release 目录。
pause
