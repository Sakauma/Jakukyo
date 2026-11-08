# 雀境 · Jakukyo

基于 TypeScript、React 与 Three.js 的离线单机 3D 麻将游戏。支持 12 种中日玩法、电脑对战与四档 AI、四套牌桌主题、本地音效与 BGM、自动存档、牌谱回放和战绩统计，可在本地浏览器或 Electron Windows 桌面版运行。

## 构建

需要 Node.js **22.12+** 与 npm。

```bash
npm ci                       # 安装依赖
npm run dev                  # 启动开发版
npm run build                # 构建网页资源
npm run package:windows:wsl  # 打包 Windows 便携版
```
