// Instance lifecycle: each "device" is one privileged redroid container plus a
// persistent /data volume folder and a unique published ADB port.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Docker from 'dockerode';
import { config } from './config.js';
import { store } from './store.js';
import * as adb from './adb.js';

const docker = new Docker(); // talks to /var/run/docker.sock

const containerName = (id) => `${config.containerPrefix}${id}`;

function allocatePort() {
  const used = new Set(store.usedAdbPorts());
  for (let p = config.adbPortBase; p <= config.adbPortMax; p++) {
    if (!used.has(p)) return p;
  }
  throw new Error('No free ADB port in configured range');
}

// Merge stored config with live Docker state into the shape the UI consumes.
async function decorate(rec) {
  let status = 'stopped';
  let containerId = null;
  try {
    const c = docker.getContainer(containerName(rec.id));
    const info = await c.inspect();
    containerId = info.Id.slice(0, 12);
    status = info.State.Running ? 'running' : 'stopped';
  } catch {
    status = 'missing'; // record exists but container was removed out-of-band
  }
  const online = status === 'running' ? await adb.isOnline(rec.adbPort) : false;
  return {
    ...rec, status, containerId, adbOnline: online,
    serial: adb.serialFor(rec.adbPort),
    rootState: rec.rootState || (rec.rooted ? 'rooted' : 'none'),
  };
}

// Docker container spec for a device record. Shared by create() and re-root
// (which recreates the container on the Magisk image, same volume/port/geometry).
function containerSpec(rec) {
  return {
    name: containerName(rec.id),
    Image: rec.image,
    Tty: true,
    OpenStdin: true,
    Labels: { 'redroid.manager': '1', 'redroid.id': rec.id, 'redroid.name': rec.name },
    // redroid boot args: display geometry + fps. Software-rendered inside a VM
    // (no GPU passthrough); fine for management/testing.
    Cmd: [
      'androidboot.redroid_width=' + rec.width,
      'androidboot.redroid_height=' + rec.height,
      'androidboot.redroid_dpi=' + rec.dpi,
      'androidboot.redroid_fps=' + rec.fps,
      'androidboot.redroid_gpu_mode=guest',
    ],
    HostConfig: {
      Privileged: true, // required: redroid needs binder / device access
      // Mount the whole binderfs dir (this host is a binderfs-only kernel, e.g.
      // Ubuntu 24.04 / 6.8) and let redroid's own init wire up /dev/binder from
      // it. Mapping individual nodes causes an early-boot race that aborts vold.
      Binds: [`${rec.dataPath}:/data`, '/dev/binderfs:/dev/binderfs'],
      PortBindings: { '5555/tcp': [{ HostIp: '127.0.0.1', HostPort: String(rec.adbPort) }] },
      RestartPolicy: { Name: 'no' },
    },
    ExposedPorts: { '5555/tcp': {} },
  };
}

export async function list() {
  return Promise.all(store.all().map(decorate));
}

export async function get(id) {
  const rec = store.get(id);
  if (!rec) return null;
  return decorate(rec);
}

export async function create({ name, image, width, height, dpi, fps }) {
  if (!config.images.some((i) => i.image === image)) throw httpErr(400, `Image not allowed: ${image}`);
  const id = crypto.randomBytes(4).toString('hex');
  const adbPort = allocatePort();
  const dataPath = path.join(config.dataRoot, id);
  fs.mkdirSync(dataPath, { recursive: true });

  // Pull the image on demand (arm64) if it's not present locally. Lets us offer
  // many Android versions without pre-downloading them all.
  await ensureImage(image);

  const rec = {
    id,
    name: (name || `device-${id}`).trim(),
    image,
    adbPort,
    dataPath,
    width: width || 720,
    height: height || 1280,
    dpi: dpi || 320,
    fps: fps || 30,
    rootState: 'none',
    createdAt: new Date().toISOString(),
  };

  await docker.createContainer(containerSpec(rec));
  return store.put(rec);
}

export async function start(id) {
  const rec = mustGet(id);
  await docker.getContainer(containerName(id)).start().catch(swallowAlready('already started'));
  // Give Android a moment to bring up adbd, then register with the local adb
  // server so ws-scrcpy can see and stream it.
  await adb.connect(rec.adbPort);
  return get(id);
}

export async function stop(id) {
  const rec = mustGet(id);
  await adb.disconnect(rec.adbPort).catch(() => {});
  await docker.getContainer(containerName(id)).stop({ t: 5 }).catch(swallowAlready('already stopped'));
  return get(id);
}

export async function remove(id, { deleteData = false } = {}) {
  const rec = mustGet(id);
  await adb.disconnect(rec.adbPort).catch(() => {});
  try {
    await docker.getContainer(containerName(id)).remove({ force: true });
  } catch { /* container may already be gone */ }
  if (deleteData) fs.rmSync(rec.dataPath, { recursive: true, force: true });
  store.delete(id);
  return { id, deletedData: deleteData };
}

// Derive the Magisk image tag from a base image: repo:tag -> repo:tag_magisk.
function rootedTag(image) {
  const i = image.lastIndexOf(':');
  const repo = image.slice(0, i);
  const tag = image.slice(i + 1).replace(/-latest$/, '');
  return `${repo}:${tag}_magisk`;
}

// One-click root: build a Magisk image for this device's Android version, then
// recreate the container on it (same /data, port, geometry). Long-running, so
// callers fire it and poll rootState via get(). Idempotent-ish on re-root.
export async function root(id) {
  const rec = mustGet(id);
  if (rec.rootState === 'rooting') return get(id);
  rec.rootState = 'rooting';
  store.put(rec);
  // Run the heavy work detached; status is observed through rootState.
  doRoot(rec).catch((err) => {
    console.error('[root] failed:', err.message);
    const r = store.get(id);
    if (r) { r.rootState = 'failed'; store.put(r); }
  });
  return get(id);
}

async function doRoot(rec) {
  const outImage = rootedTag(rec.image);

  // 1) Build the Magisk image via the one-shot rooter container.
  await runRooter(rec.image, outImage);

  // 2) Recreate the device container on the rooted image (keep /data & port).
  await adb.disconnect(rec.adbPort).catch(() => {});
  try { await docker.getContainer(containerName(rec.id)).remove({ force: true }); } catch {}
  const rooted = { ...rec, image: outImage, rootState: 'rooted', rooted: true };
  await docker.createContainer(containerSpec(rooted));
  await docker.getContainer(containerName(rec.id)).start();
  await adb.connect(rooted.adbPort);
  store.put(rooted);
  console.log(`[root] ${rec.id} rooted on ${outImage}`);

  // Best-effort: once booted, make sure the Magisk manager app is installed so
  // the user can enable Zygisk / install LSPosed. Non-blocking; su already works.
  ensureMagiskApp(rooted.adbPort).catch((e) => console.warn('[root] magisk app:', e.message));
}

async function ensureMagiskApp(adbPort) {
  if (!(await adb.waitBooted(adbPort))) return;
  await adb.shell(adbPort, 'su 0 pm install -r /system/etc/init/magisk/magisk.apk');
}

// Launch the rooter image as a one-off container and wait for it to finish.
async function runRooter(baseImage, outImage) {
  await ensureRooterImage();
  const container = await docker.createContainer({
    Image: 'redroid-rooter',
    Env: [`BASE_IMAGE=${baseImage}`, `OUTPUT_IMAGE=${outImage}`],
    HostConfig: {
      AutoRemove: false,
      Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
    },
  });
  await container.start();
  const status = await container.wait(); // { StatusCode }
  const logs = (await container.logs({ stdout: true, stderr: true })).toString();
  await container.remove({ force: true }).catch(() => {});
  if (status.StatusCode !== 0) {
    throw new Error(`rooter exited ${status.StatusCode}\n${logs.slice(-2000)}`);
  }
}

async function ensureRooterImage() {
  try { await docker.getImage('redroid-rooter').inspect(); return; } catch {}
  throw httpErr(500,
    'rooter image "redroid-rooter" is not built. Run: docker compose --profile rooter build rooter');
}

// --- helpers ---------------------------------------------------------------
function mustGet(id) {
  const rec = store.get(id);
  if (!rec) throw httpErr(404, `No such instance: ${id}`);
  return rec;
}
function httpErr(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function swallowAlready(_msg) {
  return (err) => {
    if (err.statusCode === 304) return; // Docker: not modified (already in state)
    throw err;
  };
}

// Pull `image` (linux/arm64) if not already present. Resolves when the pull
// completes. First-time pulls of a new Android version take a while (~1-2 min).
async function ensureImage(image) {
  try {
    await docker.getImage(image).inspect();
    return; // already present
  } catch { /* not present — pull it */ }
  const stream = await docker.pull(image, { platform: 'linux/arm64' });
  await new Promise((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
}

export function availableImages() {
  return config.images;
}
