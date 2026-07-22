// Minimal vanilla-JS frontend. Talks to the manager API on the same origin.
const $ = (sel, root = document) => root.querySelector(sel);
const api = (p, opts) => fetch(p, opts).then(async (r) => {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || r.statusText);
  return body;
});

let cfg = { images: [], wsScrcpyUrl: '', wsScrcpyPort: 8000 };

async function loadConfig() {
  cfg = await api('/api/config');
  const sel = $('#image-select');
  sel.innerHTML = cfg.images
    .map((i) => `<option value="${i.image}">${i.label}</option>`).join('');
  sel.addEventListener('change', syncGapps);
  syncGapps();
}

// Google Apps is only available for Android versions MindTheGapps builds for.
function syncGapps() {
  const img = $('#image-select').value;
  const entry = cfg.images.find((i) => i.image === img);
  const ok = !!(entry && entry.gapps);
  const box = $('#gapps-check');
  box.disabled = !ok;
  if (!ok) box.checked = false;
  $('#gapps-label').classList.toggle('disabled', !ok);
  $('#gapps-note').textContent = ok ? '(MindTheGapps)' : '(not available for this version)';
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
      ${d.gapps ? '<span class="badge ok">GApps</span>' : ''}
      ${d.rootState === 'rooted' ? '<span class="badge ok">root</span>' : ''}
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
    gapps: f.get('gapps') === 'on',
  };
  const msg = $('#create-msg');
  msg.textContent = payload.gapps
    ? 'Creating… building the Google Apps image for this Android version (one-time, a few minutes).'
    : 'Creating… (first use of an Android version downloads it, which can take a minute)';
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
      // Go straight to the dedicated console page (auto-streams + sidebar tools).
      window.location.href = `/device.html?id=${encodeURIComponent(id)}`;
      return;
    }
    await refresh();
  } catch (err) { alert('Error: ' + err.message); }
  finally { btn.disabled = false; }
});

$('#refresh').addEventListener('click', refresh);

// ---- boot -----------------------------------------------------------------
(async () => {
  await loadConfig();
  await refresh();
  setInterval(refresh, 5000); // keep status/adb-online fresh (booting -> online)
})();
