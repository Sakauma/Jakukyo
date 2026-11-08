import { packager } from '@electron/packager';
import { mkdir, cp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createIcon } from './create-icon.mjs';
import { curlDownloader } from './curl-downloader.mjs';
import { collectLicenses } from './collect-licenses.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const staging = join(root, '.desktop-staging');
const output = process.env.JAKUKYO_RELEASE_DIR ? resolve(process.env.JAKUKYO_RELEASE_DIR) : join(root, 'release');
const electronVersion = '45.2.3';
const packageInfo = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const appVersion = packageInfo.version;
if (!/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(appVersion)) throw new Error('Unsafe package version.');
const versionOutput = join(output, appVersion);
if (process.platform !== 'linux' || !process.env.WSL_DISTRO_NAME) throw new Error('Windows release packaging must run inside the existing WSL distribution.');
await stat(join(root, 'dist', 'index.html'));
// Only this script-owned staging directory is replaced; source and release history are retained.
if (relative(root, staging) !== '.desktop-staging') throw new Error('Unexpected staging directory.');
await rm(staging, { recursive: true, force: true }); await mkdir(staging, { recursive: true });
await mkdir(versionOutput, { recursive: true });
await cp(join(root, 'dist'), join(staging, 'dist'), { recursive: true });
await cp(join(root, 'desktop', 'main.cjs'), join(staging, 'main.cjs'));
await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(staging, 'THIRD_PARTY_NOTICES.md'));
await writeFile(join(staging, 'THIRD-PARTY-LICENSES.txt'), await collectLicenses(root));
await createIcon(join(staging, 'icon.ico'));
await writeFile(join(staging, 'package.json'), JSON.stringify({ name: 'jakukyo-desktop', productName: '雀境', version: appVersion, main: 'main.cjs', description: 'Offline 3D Mahjong', license: 'UNLICENSED' }, null, 2));

const [directory] = await packager({
  dir: staging, out: versionOutput, name: 'Jakukyo', executableName: 'Jakukyo',
  platform: 'win32', arch: 'x64', electronVersion, appVersion,
  asar: true, prune: false, overwrite: true, icon: join(staging, 'icon.ico'),
  win32metadata: { CompanyName: 'Jakukyo', ProductName: '雀境 · 3D 麻将馆', FileDescription: '雀境离线麻将' },
  download: { cacheRoot: join(root, '.electron-cache'), downloader: curlDownloader },
});
const instructions = `雀境 · 3D 麻将馆 ${appVersion}\r\n\r\n解压整个文件夹后，双击 Jakukyo.exe。无需安装 Node.js，无需联网。\r\n请保留 exe 同目录下的资源文件，不能只移动 exe。\r\n存档位于 Windows 用户的 AppData/Roaming/Jakukyo。\r\n四种牌桌主题、四级电脑难度，具体玩法与桌规见游戏大厅和规则面板。\r\n\r\n此包由 WSL ${process.env.WSL_DISTRO_NAME} 中现有 Node ${process.version} 构建。\r\nElectron ${electronVersion} / Windows x64。\r\n`;
await writeFile(join(directory, '开始游玩.txt'), instructions, 'utf8');
await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(directory, 'THIRD_PARTY_NOTICES.md'));
await cp(join(staging, 'THIRD-PARTY-LICENSES.txt'), join(directory, 'THIRD-PARTY-LICENSES.txt'));
const archive = join(output, `Jakukyo-${appVersion}-Windows-x64.zip`);
await rm(archive, { force: true });
execFileSync('/usr/bin/zip', ['-q', '-r', archive, relative(versionOutput, directory)], { cwd: versionOutput, stdio: 'inherit' });
const bytes = await readFile(archive), sha256 = createHash('sha256').update(bytes).digest('hex');
await writeFile(`${archive}.sha256`, `${sha256}  ${archive.split('/').at(-1)}\n`);
const manifest = { version: appVersion, electronVersion, nodeVersion: process.version, buildSystem: process.env.WSL_DISTRO_NAME, target: 'win32-x64', builtAt: new Date().toISOString(), archive, bytes: bytes.length, sha256, executable: join(directory, 'Jakukyo.exe') };
await writeFile(join(output, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(versionOutput, 'build-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
