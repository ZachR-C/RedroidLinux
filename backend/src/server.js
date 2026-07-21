// REST API + static UI host for the redroid manager.
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as instances from './instances.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  res.status(e.status || 500).json({ error: e.message || String(e) });
});

// Config the frontend needs (image list, how to reach ws-scrcpy).
app.get('/api/config', (req, res) => {
  res.json({
    images: instances.availableImages(),
    wsScrcpyUrl: config.wsScrcpyUrl,
    wsScrcpyPort: config.wsScrcpyPort,
  });
});

app.get('/api/instances', wrap(async (req, res) => res.json(await instances.list())));
app.get('/api/instances/:id', wrap(async (req, res) => {
  const i = await instances.get(req.params.id);
  if (!i) return res.status(404).json({ error: 'not found' });
  res.json(i);
}));
app.post('/api/instances', wrap(async (req, res) => res.status(201).json(await instances.create(req.body || {}))));
app.post('/api/instances/:id/start', wrap(async (req, res) => res.json(await instances.start(req.params.id))));
app.post('/api/instances/:id/stop', wrap(async (req, res) => res.json(await instances.stop(req.params.id))));
app.post('/api/instances/:id/root', wrap(async (req, res) => res.status(202).json(await instances.root(req.params.id))));

// APK install: the client POSTs the raw .apk bytes as the request body. We
// stream them to a temp file (no full buffering) then `adb install`. Kept off
// express.json() by streaming req directly before any body parser runs.
// Stream a raw request body to a temp file, run `handler(tmpPath)`, then clean up.
function receiveFile(req, res, ext, handler) {
  const tmp = path.join(os.tmpdir(), `up-${crypto.randomBytes(6).toString('hex')}${ext}`);
  const out = fs.createWriteStream(tmp);
  const cleanup = () => fs.rm(tmp, { force: true }, () => {});
  req.pipe(out);
  out.on('error', (e) => { cleanup(); res.status(500).json({ error: e.message }); });
  out.on('finish', async () => {
    try {
      if (fs.statSync(tmp).size < 1) throw new Error('Uploaded file is empty.');
      res.json(await handler(tmp));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    } finally { cleanup(); }
  });
}

// APK install: raw .apk bytes in the request body.
app.post('/api/instances/:id/install', (req, res) =>
  receiveFile(req, res, '.apk', (tmp) => instances.installApk(req.params.id, tmp)));

// Generic file upload: raw bytes in the body, original name in ?name=. Routed
// to the matching on-device folder (Pictures/Movies/Music/Documents/Download).
app.post('/api/instances/:id/push', (req, res) => {
  const name = path.basename(String(req.query.name || 'file'));
  receiveFile(req, res, '', (tmp) => instances.pushFile(req.params.id, tmp, name));
});
app.delete('/api/instances/:id', wrap(async (req, res) =>
  res.json(await instances.remove(req.params.id, { deleteData: req.query.data === 'true' }))));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the static management UI.
app.use('/', express.static(path.join(__dirname, '..', '..', 'frontend')));

app.listen(config.port, () => {
  console.log(`redroid-manager listening on http://0.0.0.0:${config.port}`);
});
