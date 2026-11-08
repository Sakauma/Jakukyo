# Windows 便携版打包

在 Windows 项目目录执行：

```bash
npm run package:windows:wsl
```

需要已有 WSL 发行版及其中的 Node.js 22.12+、npm、`/usr/bin/curl`、`/usr/bin/zip`。

`package.json` 和 `打包Windows.cmd` 当前指定发行版 `ubuntu2004`、脚本 `/mnt/d/unfixed/majiang/scripts/package-wsl.sh`；迁移项目时将两处改为本机路径。`scripts/package-wsl.sh` 默认使用 `/home/sakauma/.nvm/versions/node/v22.20.0/bin`，可通过 `JAKUKYO_NODE_DIRECTORY` 指定已有 Node 目录。

输出为 `release/<版本>/Jakukyo-win32-x64/` 和 `release/Jakukyo-<版本>-Windows-x64.zip`。解压整个便携包后运行 `Jakukyo.exe`。
