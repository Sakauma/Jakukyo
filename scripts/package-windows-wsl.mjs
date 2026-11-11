import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const distribution = process.env.JAKUKYO_WSL_DISTRO?.trim();
const distributionArgs = distribution ? ['--distribution', distribution] : [];
const nodeDirectory = process.env.JAKUKYO_NODE_DIRECTORY?.trim();
const environmentArgs = nodeDirectory ? ['env', `JAKUKYO_NODE_DIRECTORY=${nodeDirectory}`] : [];

function main() {
  if (process.platform !== 'win32') {
    console.error('Run this launcher from Windows. Inside WSL, use bash scripts/package-wsl.sh.');
    return 1;
  }

  const converted = spawnSync('wsl.exe', [...distributionArgs, '--exec', 'wslpath', '-a', '-u', projectRoot], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (converted.error || converted.status !== 0) {
    console.error('Unable to resolve the project path in WSL. Check the default distribution or JAKUKYO_WSL_DISTRO.');
    if (converted.error) console.error(converted.error.message);
    else if (converted.stderr?.trim()) console.error(converted.stderr.trim());
    return converted.status ?? 1;
  }

  const linuxRoot = converted.stdout.trim().replace(/\/$/, '');
  if (!linuxRoot.startsWith('/')) {
    console.error('WSL returned an invalid project path.');
    return 1;
  }
  const result = spawnSync('wsl.exe', [
    ...distributionArgs,
    '--exec', ...environmentArgs, 'bash', `${linuxRoot}/scripts/package-wsl.sh`,
    ...process.argv.slice(2),
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) console.error(result.error.message);
  return result.status ?? 1;
}

process.exitCode = main();
