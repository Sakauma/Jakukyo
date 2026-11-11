const { app, BrowserWindow, Menu, protocol, net, session } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// A standard secure local origin keeps storage and module workers usable without disabling web security.
protocol.registerSchemesAsPrivileged([{ scheme: 'jakukyo', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, stream: true } }]);
app.setName('雀境');
app.setPath('userData', path.join(app.getPath('appData'), 'Jakukyo'));

const contentPolicy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";

async function openWindow() {
  const window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 1000, minHeight: 720,
    title: '雀境 · 3D 麻将馆', backgroundColor: '#10251f', show: false,
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('jakukyo://app/')) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  await window.loadURL('jakukyo://app/index.html');
}

app.whenReady().then(async () => {
  const assetRoot = path.join(__dirname, 'dist');
  protocol.handle('jakukyo', async request => {
    const url = new URL(request.url);
    if (url.hostname !== 'app' || !['GET', 'HEAD'].includes(request.method)) return new Response('Forbidden', { status: 403 });
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { return new Response('Bad path', { status: 400 }); }
    const filePath = path.resolve(assetRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = path.relative(assetRoot, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return new Response('Forbidden', { status: 403 });
    try {
      const response = await net.fetch(pathToFileURL(filePath).toString());
      const headers = new Headers(response.headers);
      headers.set('Content-Security-Policy', contentPolicy);
      headers.set('X-Content-Type-Options', 'nosniff');
      return new Response(response.body, { status: response.status, headers });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  // This game is self-contained. Neither its renderer nor its workers need remote requests.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '游戏', submenu: [{ label: '重新加载（保留存档）', role: 'reload' }, { type: 'separator' }, { label: '退出', role: 'quit' }] },
    { label: '显示', submenu: [{ label: '全屏', role: 'togglefullscreen' }, { label: '放大界面', role: 'zoomin' }, { label: '缩小界面', role: 'zoomout' }, { label: '默认大小', role: 'resetzoom' }] },
  ]));
  await openWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void openWindow(); });
});
app.on('window-all-closed', () => app.quit());
