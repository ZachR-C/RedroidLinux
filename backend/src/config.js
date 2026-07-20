// Central configuration. Override any value via environment variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// REDROID_IMAGES env override: comma-separated image tags. Labels are derived
// from the tag. Returns null when unset so the built-in list is used.
function parseImages(env) {
  if (!env) return null;
  return env.split(',').map((s) => s.trim()).filter(Boolean)
    .map((image) => ({ label: image, image }));
}

export const config = {
  // HTTP port the manager API + UI listen on.
  port: parseInt(process.env.PORT || '8080', 10),

  // Where instance metadata is persisted (survives restarts).
  storeFile: process.env.STORE_FILE || path.join(root, 'data', 'instances.json'),

  // Host directory that holds each instance's /data volume. Each instance gets
  // a subfolder here, so an Android instance's apps/state persist when stopped.
  dataRoot: process.env.REDROID_DATA_ROOT || path.join(root, 'data', 'volumes'),

  // ADB ports are allocated from this base upward, one per instance.
  adbPortBase: parseInt(process.env.ADB_PORT_BASE || '5555', 10),
  adbPortMax: parseInt(process.env.ADB_PORT_MAX || '5700', 10),

  // How the manager reaches redroid ADB. Containers publish 5555 on the host,
  // so from the host (or a host-network container) devices are 127.0.0.1:<port>.
  adbHost: process.env.ADB_HOST || '127.0.0.1',

  // Base URL of the ws-scrcpy web UI used for in-browser manual control.
  // Empty => the frontend derives it from window.location (same host, this port).
  wsScrcpyUrl: process.env.WS_SCRCPY_URL || '',
  wsScrcpyPort: parseInt(process.env.WS_SCRCPY_PORT || '8000', 10),

  // Android images offered in the "create instance" dialog, as {label, image}.
  // On Apple Silicon (and other pure-ARMv8 hosts) prefer the _64only variants:
  // there is no 32-bit ARM execution mode, so the mixed 32/64 images crash their
  // 32-bit BoringSSL self-test and reboot-loop. The full images are listed too
  // (they work on hosts that DO have AArch32) but are flagged.
  // Images are pulled on demand when a device is first created, so listing many
  // here does not consume disk until used.
  images: parseImages(process.env.REDROID_IMAGES) || [
    { label: 'Android 16 · 64-bit only (recommended)', image: 'redroid/redroid:16.0.0_64only-latest' },
    { label: 'Android 15 · 64-bit only (recommended)', image: 'redroid/redroid:15.0.0_64only-latest' },
    { label: 'Android 14 · 64-bit only (recommended)', image: 'redroid/redroid:14.0.0_64only-latest' },
    { label: 'Android 13 · 64-bit only (recommended)', image: 'redroid/redroid:13.0.0_64only-latest' },
    { label: 'Android 12 · 64-bit only (recommended)', image: 'redroid/redroid:12.0.0_64only-latest' },
    { label: 'Android 16 (full — needs 32-bit ARM host)', image: 'redroid/redroid:16.0.0-latest' },
    { label: 'Android 15 (full — needs 32-bit ARM host)', image: 'redroid/redroid:15.0.0-latest' },
    { label: 'Android 14 (full — needs 32-bit ARM host)', image: 'redroid/redroid:14.0.0-latest' },
    { label: 'Android 13 (full — needs 32-bit ARM host)', image: 'redroid/redroid:13.0.0-latest' },
    { label: 'Android 12 (full — needs 32-bit ARM host)', image: 'redroid/redroid:12.0.0-latest' },
    { label: 'Android 11 (full — needs 32-bit ARM host)', image: 'redroid/redroid:11.0.0-latest' },
    { label: 'Android 10 (full — needs 32-bit ARM host)', image: 'redroid/redroid:10.0.0-latest' },
  ],

  containerPrefix: 'redroid_',
};
