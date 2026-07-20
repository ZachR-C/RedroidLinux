// REST API + static UI host for the redroid manager.
import express from 'express';
import path from 'node:path';
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
app.delete('/api/instances/:id', wrap(async (req, res) =>
  res.json(await instances.remove(req.params.id, { deleteData: req.query.data === 'true' }))));

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve the static management UI.
app.use('/', express.static(path.join(__dirname, '..', '..', 'frontend')));

app.listen(config.port, () => {
  console.log(`redroid-manager listening on http://0.0.0.0:${config.port}`);
});
