// Instance lifecycle: each "device" is one privileged redroid container plus a
// persistent /data volume folder and a unique published ADB port.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Docker from 'dockerode';
import { config, versionKey, supportsGapps } from './config.js';
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
      // ADB stays bound to localhost on the server; remote machines reach it
      // securely by SSH-tunnelling the host's adb server (see remoteInfo).
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

export async function create({ name, image, width, height, dpi, fps, gapps }) {
  if (!config.images.some((i) => i.image === image)) throw httpErr(400, `Image not allowed: ${image}`);
  const id = crypto.randomBytes(4).toString('hex');
  const adbPort = allocatePort();
  const dataPath = path.join(config.dataRoot, id);
  fs.mkdirSync(dataPath, { recursive: true });

  // Pull the image on demand (arm64) if it's not present locally. Lets us offer
  // many Android versions without pre-downloading them all.
  await ensureImage(image);

  // Optionally bake in Google Apps. The _gapps image is built once per Android
  // version and reused by every later device on that version.
  if (gapps) image = await ensureGappsImage(image);

  const rec = {
    id,
    name: (name || `device-${id}`).trim(),
    image,
    baseImage: image, // the un-rooted image; root always builds FROM this
    gapps: !!gapps,
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
  // Reclaim built variant images (_magisk / _gapps) once nothing references
  // them. Pulled base (-latest) images are left alone — they're shared and
  // re-pulled on demand anyway.
  if (/_(magisk|gapps)/.test(rec.image || '') && !store.all().some((r) => r.image === rec.image)) {
    try { await docker.getImage(rec.image).remove(); } catch {}
  }
  return { id, deletedData: deleteData };
}

// Remove and re-create the device container from `rec` (new image / port bind /
// geometry), then start + adb-connect. Persists rec. Reboots the emulator.
async function recreate(rec) {
  await adb.disconnect(rec.adbPort).catch(() => {});
  try { await docker.getContainer(containerName(rec.id)).remove({ force: true }); } catch {}
  await docker.createContainer(containerSpec(rec));
  await docker.getContainer(containerName(rec.id)).start();
  await adb.connect(rec.adbPort);
  store.put(rec);
  return rec;
}

// Best-effort primary IPv4 of this host (backend runs with host networking, so
// these are the server's real interfaces). Used as the default remote host.
function primaryHost() {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
}

// Connection info for reaching this device's ADB from another computer. Remote
// machines tunnel the server's adb SERVER (5037) over SSH and talk to it as a
// client — this shares the one adb server on the host (which ws-scrcpy also
// uses) instead of fighting over the device's single adbd transport.
export async function remoteInfo(id) {
  const rec = mustGet(id);
  const host = config.publicHost || primaryHost();
  return {
    adbPort: rec.adbPort,
    serial: adb.serialFor(rec.adbPort), // as seen on the server, e.g. 127.0.0.1:5558
    host,
    sshUser: config.sshUser,
    sshPort: config.sshPort,
    adbServerPort: 5037,
    autodetectedHost: primaryHost(),
  };
}

// Install an APK (already saved to filePath) onto a running device via adb.
export async function installApk(id, filePath) {
  const rec = mustGet(id);
  if (!(await adb.isOnline(rec.adbPort))) throw httpErr(409, 'Device is not online — Start it first.');
  const out = await adb.install(rec.adbPort, filePath);
  if (!/Success/i.test(out)) throw httpErr(422, `Install failed: ${out.trim().slice(0, 500)}`);
  return { ok: true, output: out.trim() };
}

// Pick the natural on-device folder for a file by extension.
function remoteDirFor(filename) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif'].includes(ext)) return '/sdcard/Pictures';
  if (['mp4', 'mkv', 'webm', 'mov', 'avi', '3gp', 'm4v'].includes(ext)) return '/sdcard/Movies';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus'].includes(ext)) return '/sdcard/Music';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'epub'].includes(ext)) return '/sdcard/Documents';
  return '/sdcard/Download';
}

// Push an arbitrary file to the device's shared storage, into the folder that
// matches its type, then best-effort media-scan so it shows up in gallery/apps.
export async function pushFile(id, filePath, filename) {
  const rec = mustGet(id);
  if (!(await adb.isOnline(rec.adbPort))) throw httpErr(409, 'Device is not online — Start it first.');
  const safe = filename.replace(/[/\\]/g, '_').replace(/^\.+/, '') || 'file';
  const dir = remoteDirFor(safe);
  const remotePath = `${dir}/${safe}`;
  await adb.shell(rec.adbPort, `mkdir -p '${dir}'`);
  const out = await adb.push(rec.adbPort, filePath, remotePath);
  if (/error:|failed to|no such/i.test(out) && !/pushed/i.test(out)) {
    throw httpErr(422, `Upload failed: ${out.trim().slice(0, 500)}`);
  }
  // Make it visible to the gallery/Files app (best-effort; ignore failures).
  await adb.shell(rec.adbPort,
    `am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${remotePath}`).catch(() => {});
  return { ok: true, remotePath, output: out.trim() };
}

// Recover the un-rooted base tag from any image (handles legacy _magisk images
// that predate baseImage tracking): repo:13.0.0_64only_magisk -> repo:13.0.0_64only-latest.
function deriveBase(image) {
  const i = image.lastIndexOf(':');
  const repo = image.slice(0, i);
  const tag = image.slice(i + 1).replace(/(_magisk)+$/, '').replace(/-latest$/, '');
  return `${repo}:${tag}-latest`;
}

// Google Apps image tag: repo:13.0.0_64only-latest -> repo:13.0.0_64only_gapps.
function gappsTag(baseImage) {
  const i = baseImage.lastIndexOf(':');
  return `${baseImage.slice(0, i)}:${baseImage.slice(i + 1).replace(/-latest$/, '')}_gapps`;
}

// Build (once per Android version) a MindTheGapps variant of `baseImage` and
// return its tag. Reused by every later device on the same version.
async function ensureGappsImage(baseImage) {
  if (!supportsGapps(baseImage)) {
    throw httpErr(400,
      `Google Apps isn't available for ${versionKey(baseImage)}. ` +
      'MindTheGapps ships builds for Android 15/14/13/12 (and 13/12 _64only).');
  }
  const out = gappsTag(baseImage);
  try { await docker.getImage(out).inspect(); return out; } catch { /* build it */ }
  console.log(`[gapps] building ${out} from ${baseImage}`);
  await runBuilder(baseImage, out, ['mindthegapps']);
  await pruneDangling();
  return out;
}

// Magisk image tag for a base: repo:13.0.0_64only-latest -> repo:13.0.0_64only_magisk.
function rootedTag(baseImage) {
  const i = baseImage.lastIndexOf(':');
  const repo = baseImage.slice(0, i);
  const tag = baseImage.slice(i + 1).replace(/-latest$/, '');
  return `${repo}:${tag}_magisk`;
}

// Remove dangling (untagged) images left behind by rebuilds. Best-effort.
async function pruneDangling() {
  try { await docker.pruneImages({ filters: { dangling: ['true'] } }); } catch {}
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
  // Always build FROM the un-rooted base (never FROM an already-rooted image —
  // that double-layers Magisk and wastes a full image), and reuse a stable tag
  // so re-rooting replaces it and the old one is pruned.
  const base = rec.baseImage || deriveBase(rec.image);
  const outImage = rootedTag(base);

  // 1) Build the Magisk image via the one-shot rooter container.
  await runBuilder(base, outImage, ['magisk']);

  // 2) Recreate the device container on the rooted image (keep /data & port).
  const oldImage = rec.image;
  const rooted = { ...rec, baseImage: base, image: outImage, rootState: 'rooted', rooted: true };
  await recreate(rooted);
  // Reclaim the device's previous rooted image if re-rooting changed the tag and
  // nothing else uses it (e.g. cleaning up legacy _magisk_magisk artifacts).
  if (oldImage && oldImage !== outImage && /_magisk(_magisk)*$/.test(oldImage) &&
      !store.all().some((r) => r.image === oldImage)) {
    try { await docker.getImage(oldImage).remove(); } catch {}
  }
  await pruneDangling();
  console.log(`[root] ${rec.id} rooted on ${outImage}`);

  // Best-effort: once booted, make sure the Magisk manager app is installed so
  // the user can enable Zygisk / install LSPosed. Non-blocking; su already works.
  ensureMagiskApp(rooted.adbPort).catch((e) => console.warn('[root] magisk app:', e.message));
}

async function ensureMagiskApp(adbPort) {
  if (!(await adb.waitBooted(adbPort))) return;
  await adb.shell(adbPort, 'su 0 pm install -r /system/etc/init/magisk/magisk.apk');
}

// Launch the one-shot builder image and wait for it to finish. `modules` is a
// list of redroid-script modules to inject (magisk, mindthegapps).
async function runBuilder(baseImage, outImage, modules) {
  await ensureRooterImage();
  const container = await docker.createContainer({
    Image: 'redroid-rooter',
    Env: [
      `BASE_IMAGE=${baseImage}`,
      `OUTPUT_IMAGE=${outImage}`,
      `MODULES=${modules.join(',')}`,
      `ANDROID_VERSION=${versionKey(baseImage)}`,
    ],
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
    throw new Error(`builder exited ${status.StatusCode}\n${logs.slice(-2000)}`);
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
