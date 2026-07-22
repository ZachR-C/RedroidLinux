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
  // View is enabled only once Android reports boot_completed. adbd comes up long
  // before the display stack, so streaming earlier gives a dead grey view — the
  // button stays greyed with "booting…" until it's genuinely ready.
  const canView = running && d.booted;
  const booting = running && !d.booted;
  const rooted = d.rootState === 'rooted';
  return `
  <div class="card" data-id="${d.id}">
    <div class="card-head">
      <strong>${d.name}</strong> ${badge(d.status)}
      ${booting ? '<span class="badge idle">booting…</span>' : ''}
      ${d.gapps ? '<span class="badge ok">GApps</span>' : ''}
      ${rooted ? '<span class="badge ok">root</span>' : ''}
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
      <button data-act="view" ${canView ? '' : 'disabled'}
        title="${booting ? 'Available once Android finishes booting' : 'Open the live screen'}">View</button>
      ${booting && rooted ? '<button data-act="safemode" class="danger" title="If it is stuck booting (e.g. a bad Magisk module), disable all modules and reboot">🛟 Safe mode</button>' : ''}
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
    } else if (act === 'safemode') {
      if (!confirm('Stuck booting? Disable ALL Magisk modules and reboot this device?')) { btn.disabled = false; return; }
      await api(`/api/instances/${id}/safe-mode`, { method: 'POST' });
    }
    await refresh();
  } catch (err) { alert('Error: ' + err.message); }
  finally { btn.disabled = false; }
});

$('#refresh').addEventListener('click', refresh);

// ---- storage manager ----
const fmt = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
};

async function loadStorage() {
  const s = await api('/api/storage');
  if (s.disk) {
    const cls = s.disk.pct >= 90 ? 'bad' : s.disk.pct >= 75 ? 'warn' : 'ok';
    $('#st-disk').innerHTML = `
      <div class="st-bar"><div class="st-fill ${cls}" style="width:${s.disk.pct}%"></div></div>
      <p class="msg"><strong>${fmt(s.disk.used)}</strong> used of ${fmt(s.disk.total)}
        · <strong>${fmt(s.disk.free)}</strong> free (${s.disk.pct}%)</p>`;
  }
  $('#st-bc-size').textContent = `(${fmt(s.buildCache)})`;
  $('#st-dg-size').textContent = `(${s.danglingCount} · ${fmt(s.danglingBytes)})`;
  $('#st-un-size').textContent = `(${fmt(s.unusedImageBytes)})`;
  $('#st-or-size').textContent = `(${s.orphans.length} · ${fmt(s.orphanBytes)})`;
  $('#st-locked').innerHTML = s.lockedBytes
    ? `<span class="muted">${fmt(s.lockedBytes)} is held by older image versions still pinned to existing
       devices' containers — that space only frees up if you delete those devices.</span>`
    : '';

  $('#st-images').innerHTML = s.images.length ? s.images.map((i) => `
    <div class="st-row">
      <label>
        <input type="checkbox" class="st-img" value="${i.tag}" ${i.inUse ? 'disabled' : ''} />
        <code>${i.tag}</code>
      </label>
      <span>${fmt(i.size)} ${i.inUse ? '<span class="badge ok">in use</span>' : '<span class="badge idle">unused</span>'}</span>
    </div>`).join('') : '<p class="msg">No Android images.</p>';

  $('#st-devices').innerHTML = s.devices.length ? s.devices.map((d) => `
    <div class="st-row">
      <span><strong>${d.name}</strong>
        ${d.gapps ? '<span class="badge ok">GApps</span>' : ''}
        ${d.rootState === 'rooted' ? '<span class="badge ok">root</span>' : ''}
        <br /><code class="muted">${d.image}</code></span>
      <span>${fmt(d.dataSize)}
        <button data-wipe="${d.id}" class="ghost">Wipe</button>
        <button data-del="${d.id}" class="danger">Delete</button>
      </span>
    </div>`).join('') : '<p class="msg">No devices.</p>';
}

$('#storage-btn').addEventListener('click', async () => {
  $('#storage-modal').classList.remove('hidden');
  $('#st-msg').textContent = 'Loading…';
  await loadStorage();
  $('#st-msg').textContent = '';
});
$('#st-close').addEventListener('click', () => $('#storage-modal').classList.add('hidden'));

$('#st-run').addEventListener('click', async () => {
  const targets = [];
  if ($('#st-buildcache').checked) targets.push('buildCache');
  if ($('#st-dangling').checked) targets.push('dangling');
  if ($('#st-unused').checked) targets.push('unusedImages');
  if ($('#st-orphans').checked) targets.push('orphans');
  if (!targets.length) { $('#st-msg').textContent = 'Nothing selected.'; return; }
  $('#st-msg').textContent = '⏳ Reclaiming…';
  try {
    const r = await api('/api/storage/prune', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets }),
    });
    $('#st-msg').textContent = `✅ Reclaimed ${fmt(r.reclaimed)}.`;
    await loadStorage();
  } catch (e) { $('#st-msg').textContent = '❌ ' + e.message; }
});

$('#st-del-images').addEventListener('click', async () => {
  const imgs = [...document.querySelectorAll('.st-img:checked')].map((c) => c.value);
  if (!imgs.length) { $('#st-msg').textContent = 'No images checked.'; return; }
  if (!confirm(`Delete ${imgs.length} image(s)?\n\nThey re-download automatically if a device needs them again.`)) return;
  $('#st-msg').textContent = '⏳ Deleting…';
  try {
    const r = await api('/api/storage/prune', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ images: imgs }),
    });
    $('#st-msg').textContent = `✅ Reclaimed ${fmt(r.reclaimed)}.`;
    await loadStorage();
  } catch (e) { $('#st-msg').textContent = '❌ ' + e.message; }
});

$('#st-devices').addEventListener('click', async (e) => {
  const wipe = e.target.closest('button[data-wipe]');
  const del = e.target.closest('button[data-del]');
  try {
    if (wipe) {
      if (!confirm('Factory-reset this device?\n\nStops it and erases all apps & settings. The device itself is kept.')) return;
      $('#st-msg').textContent = '⏳ Wiping…';
      await api(`/api/instances/${wipe.dataset.wipe}/wipe`, { method: 'POST' });
    } else if (del) {
      if (!confirm('Delete this device and its data permanently?')) return;
      $('#st-msg').textContent = '⏳ Deleting…';
      await api(`/api/instances/${del.dataset.del}?data=true`, { method: 'DELETE' });
    } else return;
    $('#st-msg').textContent = '✅ Done.';
    await loadStorage();
    await refresh();
  } catch (err) { $('#st-msg').textContent = '❌ ' + err.message; }
});

// ---- boot -----------------------------------------------------------------
(async () => {
  await loadConfig();
  await refresh();
  setInterval(refresh, 5000); // keep status/adb-online fresh (booting -> online)
})();
