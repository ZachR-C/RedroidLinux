// Tiny JSON-file persistence for instance metadata. The Docker daemon is the
// source of truth for *runtime* state (running/stopped); this store only holds
// the intent/config we can't recover from Docker labels alone, keyed by id.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(config.storeFile, 'utf8'));
  } catch {
    cache = { instances: {} };
  }
  return cache;
}

function flush() {
  ensureDir(config.storeFile);
  fs.writeFileSync(config.storeFile, JSON.stringify(cache, null, 2));
}

export const store = {
  all() {
    return Object.values(load().instances);
  },
  get(id) {
    return load().instances[id] || null;
  },
  put(rec) {
    load().instances[rec.id] = rec;
    flush();
    return rec;
  },
  delete(id) {
    delete load().instances[id];
    flush();
  },
  usedAdbPorts() {
    return this.all().map((r) => r.adbPort).filter(Boolean);
  },
};
