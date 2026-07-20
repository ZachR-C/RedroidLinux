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
  return { ...rec, status, containerId, adbOnline: online, serial: adb.serialFor(rec.adbPort) };
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
  if (!config.images.includes(image)) throw httpErr(400, `Image not allowed: ${image}`);
  const id = crypto.randomBytes(4).toString('hex');
  const adbPort = allocatePort();
  const dataPath = path.join(config.dataRoot, id);
  fs.mkdirSync(dataPath, { recursive: true });

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
    createdAt: new Date().toISOString(),
  };

  await docker.createContainer({
    name: containerName(id),
    Image: image,
    Tty: true,
    OpenStdin: true,
    Labels: { 'redroid.manager': '1', 'redroid.id': id, 'redroid.name': rec.name },
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
      Binds: [`${dataPath}:/data`],
      PortBindings: { '5555/tcp': [{ HostIp: '127.0.0.1', HostPort: String(adbPort) }] },
      RestartPolicy: { Name: 'no' },
    },
    ExposedPorts: { '5555/tcp': {} },
  });

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

export function availableImages() {
  return config.images;
}
