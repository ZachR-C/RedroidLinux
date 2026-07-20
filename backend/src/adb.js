// Thin wrapper around the adb CLI. ws-scrcpy discovers devices through the
// local adb server, so after a container starts we must `adb connect` to its
// published ADB port; before deleting we `adb disconnect` to keep adb tidy.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from './config.js';

const run = promisify(execFile);

async function adb(args) {
  try {
    const { stdout } = await run('adb', args, { timeout: 15000 });
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
