// Storage reporting + reclaim actions for the Storage Manager UI.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import Docker from 'dockerode';
import { config } from './config.js';
import { store } from './store.js';

const run = promisify(execFile);
const docker = new Docker();

const dirSize = async (p) => {
  try {
    const { stdout } = await run('du', ['-sb', p], { timeout: 60000 });
    return parseInt(stdout.split('\t')[0], 10) || 0;
  } catch { return 0; }
};

// Images referenced by a device record — never auto-removed.
const referencedImages = () => new Set(store.all().map((r) => r.image).filter(Boolean));

export async function info() {
  const [df, images, containers, statfs] = await Promise.all([
    docker.df().catch(() => null),
    docker.listImages().catch(() => []),
    docker.listContainers({ all: true }).catch(() => []),
    fs.promises.statfs(config.dataRoot).catch(() => null),
  ]);
  // Images still referenced by ANY container (even stopped) can't be removed by
  // Docker, so they must not be reported as reclaimable.
  const heldByContainer = new Set(containers.map((c) => c.ImageID).filter(Boolean));

  const disk = statfs ? {
    total: statfs.blocks * statfs.bsize,
    free: statfs.bavail * statfs.bsize,
    used: (statfs.blocks - statfs.bfree) * statfs.bsize,
  } : null;
  if (disk) disk.pct = disk.total ? Math.round((disk.used / disk.total) * 100) : 0;

  const inUse = referencedImages();
  const tagged = [];
  let danglingBytes = 0;
  let danglingCount = 0;
  let lockedBytes = 0; // untagged but pinned by an existing container
  for (const img of images) {
    const tags = img.RepoTags || [];
    const held = heldByContainer.has(img.Id);
    if (!tags.length || tags[0] === '<none>:<none>') {
      if (held) lockedBytes += img.Size || 0;
      else { danglingCount++; danglingBytes += img.Size || 0; }
      continue;
    }
    for (const tag of tags) {
      if (!tag.startsWith('redroid/redroid')) continue;
      // "in use" = a device record points at it, or a container still holds it.
      tagged.push({ tag, size: img.Size || 0, inUse: inUse.has(tag) || held });
    }
  }
  tagged.sort((a, b) => b.size - a.size);

  const buildCache = (df && df.BuildCache)
    ? df.BuildCache.reduce((n, c) => n + (c.InUse ? 0 : (c.Size || 0)), 0) : 0;

  // Per-device data volumes + orphaned volume dirs (no device record).
  const ids = new Set(store.all().map((r) => r.id));
  let orphans = [];
  try {
    const entries = await fs.promises.readdir(config.dataRoot);
    orphans = await Promise.all(entries.filter((e) => !ids.has(e))
      .map(async (e) => ({ name: e, size: await dirSize(path.join(config.dataRoot, e)) })));
  } catch { /* dataRoot may not exist yet */ }

  const devices = await Promise.all(store.all().map(async (r) => ({
    id: r.id, name: r.name, image: r.image, gapps: !!r.gapps,
    rootState: r.rootState || 'none',
    dataSize: await dirSize(r.dataPath),
  })));
  devices.sort((a, b) => b.dataSize - a.dataSize);

  return {
    disk,
    images: tagged,
    unusedImageBytes: tagged.filter((t) => !t.inUse).reduce((n, t) => n + t.size, 0),
    danglingCount, danglingBytes,
    // Old image versions pinned by a device's existing container — only freed by
    // deleting (or recreating) that device, so not offered as reclaimable.
    lockedBytes,
    buildCache,
    orphans,
    orphanBytes: orphans.reduce((n, o) => n + o.size, 0),
    devices,
    dockerTotals: df ? {
      images: (df.Images || []).reduce((n, i) => n + (i.Size || 0), 0),
      containers: (df.Containers || []).reduce((n, c) => n + (c.SizeRw || 0), 0),
    } : null,
  };
}

// Run the requested reclaim actions. `targets` is a list of:
//   buildCache | dangling | unusedImages | orphans
// plus optional `images: [tag...]` to remove specific (unreferenced) images.
export async function prune({ targets = [], images = [] } = {}) {
  const done = [];
  const t = new Set(targets);

  if (t.has('buildCache')) {
    try { const r = await docker.pruneBuilder(); done.push({ action: 'buildCache', reclaimed: r.SpaceReclaimed || 0 }); }
    catch (e) { done.push({ action: 'buildCache', error: e.message }); }
  }
  if (t.has('dangling')) {
    try {
      const r = await docker.pruneImages({ filters: { dangling: ['true'] } });
      done.push({ action: 'dangling', reclaimed: r.SpaceReclaimed || 0 });
    } catch (e) { done.push({ action: 'dangling', error: e.message }); }
  }
  if (t.has('unusedImages')) {
    const inUse = referencedImages();
    const list = await docker.listImages().catch(() => []);
    let removed = 0;
    for (const img of list) {
      for (const tag of img.RepoTags || []) {
        if (!tag.startsWith('redroid/redroid') || inUse.has(tag)) continue;
        try { await docker.getImage(tag).remove(); removed += img.Size || 0; } catch { /* in use */ }
      }
    }
    done.push({ action: 'unusedImages', reclaimed: removed });
  }
  // Explicit image removals (UI checkboxes) — refuse anything still referenced.
  if (images.length) {
    const inUse = referencedImages();
    let removed = 0;
    for (const tag of images) {
      if (inUse.has(tag)) continue;
      try { const i = docker.getImage(tag); const d = await i.inspect(); await i.remove(); removed += d.Size || 0; }
      catch { /* ignore */ }
    }
    done.push({ action: 'images', reclaimed: removed });
  }
  if (t.has('orphans')) {
    const ids = new Set(store.all().map((r) => r.id));
    let removed = 0;
    try {
      for (const e of await fs.promises.readdir(config.dataRoot)) {
        if (ids.has(e)) continue;
        const p = path.join(config.dataRoot, e);
        removed += await dirSize(p);
        fs.rmSync(p, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
    done.push({ action: 'orphans', reclaimed: removed });
  }

  return { done, reclaimed: done.reduce((n, d) => n + (d.reclaimed || 0), 0) };
}
