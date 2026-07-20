// Minimal vanilla-JS frontend. Talks to the manager API on the same origin.
const $ = (sel, root = document) => root.querySelector(sel);
const api = (p, opts) => fetch(p, opts).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
});

let cfg = { images: [], wsScrcpyUrl: '', wsScrcpyPort: 8000 };

// Base URL of the ws-scrcpy web UI (device-list page). ws-scrcpy builds the
// live-stream websocket URL itself at runtime from the device's interfaces
// (there is no stable static deep-link), so we load its device list and the
// user clicks "Configure stream" on their device to open the interactive view.
function wsScrcpyBase() {
  return cfg.wsScrcpyUrl ||
    `${location.protocol}//${location.hostname}:${cfg.wsScrcpyPort}`;
}

async function loadConfig() {
  cfg = await api('/api/config');
  const sel = $('#image-select');
  sel.innerHTML = cfg.images.map((i) => `<option value="${i}">${i}</option>`).join('');
}

function badge(status) {
  const map = { running: 'ok', stopped: 'idle', missing: 'warn' };
  return `<span class="badge ${map[status] || 'idle'}">${status}</span>`;
}

function deviceCard(d) {
  const running = d.status === 'running';
  const canView = running && d.adbOnline;
  return `
  <div class="card" data-id="${d.id}">
    <div class="card-head">
      <strong>${d.name}</strong> ${badge(d.status)}
      ${running && !d.adbOnline ? '<span class="badge idle">booting…</span>' : ''}
    </div>
    <div class="meta">
      <div>${d.image}</div>
      <div>${d.width}×${d.height} · ${d.dpi}dpi · ${d.fps}fps</div>
      <div>adb: <code>${d.serial}</code></div>
    </div>
    <div class="actions">
      ${running
        ? `<button data-act="stop">Stop</button>`
        : `<button data-act="start" class="primary">Start</button>`}
      <button data-act="view" ${canView ? '' : 'disabled'}>View</button>
      <button data-act="delete" class="danger">Delete</button>
    </div>
  </div>`;
}

async function refresh() {
  const list = await api('/api/instances');
  $('#list').innerHTML = list.length
    ? list.map(deviceCard).join('')
    : '<p class="msg">No devices yet — create one above.</p>';
}

// ---- events ---------------------------------------------------------------
$('#create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const payload = {
    name: f.get('name'),
    image: f.get('image'),
    width: +f.get('width'), height: +f.get('height'),
    dpi: +f.get('dpi'), fps: +f.get('fps'),
  };
  const msg = $('#create-msg');
  msg.textContent = 'Creating…';
  try {
    const d = await api('/api/instances', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    msg.textContent = `Created ${d.name} (${d.id}).`;
    await refresh();
  } catch (err) { msg.textContent = 'Error: ' + err.message; }
});

$('#list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = e.target.closest('.card');
  const id = card.dataset.id;
  const act = btn.dataset.act;
  btn.disabled = true;
  try {
    if (act === 'start') await api(`/api/instances/${id}/start`, { method: 'POST' });
    else if (act === 'stop') await api(`/api/instances/${id}/stop`, { method: 'POST' });
    else if (act === 'delete') {
      const wipe = confirm('Delete this device?\n\nOK = also erase its /data (apps & state).\nCancel = keep it running/existing.');
      if (!wipe) { btn.disabled = false; return; }
      const alsoData = confirm('Erase the saved /data volume too? OK = wipe, Cancel = keep files.');
      await api(`/api/instances/${id}?data=${alsoData}`, { method: 'DELETE' });
    } else if (act === 'view') {
      const d = await api(`/api/instances/${id}`);
      openViewer(d);
    }
    await refresh();
  } catch (err) { alert('Error: ' + err.message); }
  finally { btn.disabled = false; }
});

function openViewer(d) {
  const url = wsScrcpyBase() + '/';
  $('#viewer-title').textContent = `${d.name} — ${d.serial}`;
  $('#viewer-hint').textContent =
    `Find "${d.serial}" below → click "Configure stream" → Start. You can then control the phone with your mouse.`;
  $('#viewer-open').href = url;
  $('#viewer-frame').src = url;
  $('#viewer').classList.remove('hidden');
}
$('#viewer-close').addEventListener('click', () => {
  $('#viewer').classList.add('hidden');
  $('#viewer-frame').src = 'about:blank';
});
$('#refresh').addEventListener('click', refresh);

// ---- boot -----------------------------------------------------------------
(async () => {
  await loadConfig();
  await refresh();
  setInterval(refresh, 5000); // keep status/adb-online fresh (booting -> online)
})();
