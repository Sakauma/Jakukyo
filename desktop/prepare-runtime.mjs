import { downloadArtifact } from '@electron/get';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { curlDownloader } from './curl-downloader.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const archive = await downloadArtifact({ version: '45.2.3', platform: 'win32', arch: 'x64', artifactName: 'electron', cacheRoot: join(root, '.electron-cache'), downloader: curlDownloader });
console.log(`Official Electron Windows runtime cached: ${archive}`);
