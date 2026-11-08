import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
// Existing WSL curl handles the host network path; electron/get still verifies official SHA-256.
export const curlDownloader = {
  async download(url, targetFilePath) {
    await run('/usr/bin/curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2', '--retry-delay', '1', '--connect-timeout', '20', '--max-time', '600', '--proto', '=https', '--output', targetFilePath, url], { timeout: 650000 });
  },
};
