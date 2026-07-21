// Thin wrapper around the adb CLI. ws-scrcpy discovers devices through the
// local adb server, so after a container starts we must `adb connect` to its
// published ADB port; before deleting we `adb disconnect` to keep adb tidy.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const run = promisify(execFile);

async function adb(args, timeout = 15000) {
  try {
    const { stdout } = await run('adb', args, { timeout, maxBuffer: 8 * 1024 * 1024 });
    return stdout.trim();
  } catch (err) {
    // adb often exits non-zero with a useful message on stdout/stderr.
    return (err.stdout || '') + (err.stderr || err.message || '');
  }
}

export const serialFor = (adbPort) => `${config.adbHost}:${adbPort}`;

export async function connect(adbPort) {
  return adb(['connect', serialFor(adbPort)]);
}

export async function disconnect(adbPort) {
  return adb(['disconnect', serialFor(adbPort)]);
}

export async function isOnline(adbPort) {
  const out = await adb(['devices']);
  const line = out.split('\n').find((l) => l.startsWith(serialFor(adbPort)));
  return !!line && /\bdevice\b/.test(line);
}

export async function shell(adbPort, command) {
  return adb(['-s', serialFor(adbPort), 'shell', command]);
}

export async function install(adbPort, filePath) {
  // -r reinstall keeping data, -g grant runtime perms. Big APKs need time.
  return adb(['-s', serialFor(adbPort), 'install', '-r', '-g', filePath], 300000);
}

// Wait until Android reports sys.boot_completed=1 (or time out). Returns bool.
export async function waitBooted(adbPort, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const out = (await shell(adbPort, 'getprop sys.boot_completed')).trim();
    if (out === '1') return true;
    await new Promise((r) => setTimeout(r, 4000));
  }
  return false;
}
