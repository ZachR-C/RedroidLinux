// Central configuration. Override any value via environment variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

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

  // Docker image allow-list offered in the "create instance" dialog.
  // Use the _64only variants: Apple Silicon (and other pure-ARMv8 hosts) has no
  // 32-bit ARM execution mode, so the mixed 32/64 images crash their 32-bit
  // BoringSSL self-test and reboot-loop. 64-bit-only images avoid that entirely.
  images: (process.env.REDROID_IMAGES ||
    'redroid/redroid:13.0.0_64only-latest,redroid/redroid:12.0.0_64only-latest'
  ).split(',').map((s) => s.trim()).filter(Boolean),

  containerPrefix: 'redroid_',
};
