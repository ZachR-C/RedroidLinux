// Device console: auto-loads the live scrcpy stream for one instance and
// provides a sidebar to switch player, toggle fit-to-screen, open ws-scrcpy
// tools beside the stream, and one-click root the device.
//
// Stream URL is built exactly like ws-scrcpy's own device list (see
// StreamClientScrcpy + BaseDeviceTracker.buildLink):
//   http://<host>:<wsPort>/#!action=stream&udid=<serial>&player=<code>
//        &ws=ws://<host>:<wsPort>/?action=proxy-adb&remote=tcp:8886&udid=<serial>
//   (&fit=1 → fit-to-screen; honored by our patched ws-scrcpy build)
// 8886 = scrcpy SERVER_PORT. Tool URLs are just #!action=<a>&udid=<serial>.
const $ = (s) => document.querySelector(s);
const api = (p, opts) => fetch(p, opts).then((r) => r.json());

const SCRCPY_SERVER_PORT = 8886;
const PLAYERS = [
  { code: 'broadway', name: 'Broadway.js' },
  { code: 'mse', name: 'H264 Converter' },
  { code: 'tinyh264', name: 'Tiny H264' },
];
const TOOL_NAMES = { shell: 'Shell', devtools: 'Devtools', 'list-files': 'List files' };

const params = new URLSearchParams(location.search);
const id = params.get('id');

let cfg = { wsScrcpyPort: 8000 };
let device = null;
let currentPlayer = params.get('player') || 'broadway';
let fit = true;

const wsHost = () => location.hostname;
const wsPort = () => cfg.wsScrcpyPort || 8000;
const proxyWs = (serial) =>
  `ws://${wsHost()}:${wsPort()}/?action=proxy-adb&remote=tcp:${SCRCPY_SERVER_PORT}&udid=${serial}`;

function streamUrl(serial, player) {
  const q = new URLSearchParams({ action: 'stream', udid: serial, player, ws: proxyWs(serial) });
  if (fit) q.set('fit', '1');
  return `http://${wsHost()}:${wsPort()}/#!${q.toString()}`;
}
function toolUrl(serial, action) {
  const q = new URLSearchParams({ action, udid: serial });
  return `http://${wsHost()}:${wsPort()}/#!${q.toString()}`;
}

function renderPlayers() {
  $('#players').innerHTML = PLAYERS.map((p) =>
    `<button data-player="${p.code}" class="${p.code === currentPlayer ? 'primary' : ''}">${p.name}</button>`
  ).join('');
}

function loadStream() {
  if (!device || !device.booted) return; // never connect scrcpy before boot completes
  const url = streamUrl(device.serial, currentPlayer);
  $('#stream-status').textContent = '';
  $('#stream-frame').src = url;
  $('#open-tab').href = url;
  renderPlayers();
}

function openTool(action) {
  if (!device) return;
  const url = toolUrl(device.serial, action);
  $('#tool-title').textContent = `${TOOL_NAMES[action] || action} — ${device.serial}`;
  $('#tool-open').href = url;
  $('#tool-frame').src = url;
  $('#tool-panel').classList.remove('hidden');
}

async function boot() {
  cfg = await api('/api/config');
  device = await api(`/api/instances/${id}`);
  if (!device || device.error) { $('#side-msg').textContent = 'Device not found.'; return; }

  $('#dev-name').textContent = device.name;
  $('#dev-serial').textContent = device.serial;
  renderStatus();

  // Never start the stream before Android reports boot_completed: scrcpy
  // connected too early produces a grey view that never recovers.
  if (!device.booted) {
    const ok = await waitUntilBooted();
    if (!ok) return;
  }
  loadStream();
  pollRoot();
}

// Poll until the device reports booted. Returns false if it isn't running.
async function waitUntilBooted() {
  for (;;) {
    if (device.status !== 'running') {
      $('#side-msg').innerHTML =
        'Device is not running. <a href="/">Go back</a> and press Start.';
      $('#stream-status').textContent = 'Not running';
      return false;
    }
    $('#stream-status').innerHTML =
      '<span class="spinner"></span> Waiting for Android to finish booting…<br>'
      + '<small>The screen opens automatically — starting it earlier gives a blank view.</small>';
    await new Promise((r) => setTimeout(r, 3000));
    device = await api(`/api/instances/${id}`);
    renderStatus();
    if (device.booted) { $('#stream-status').textContent = ''; return true; }
  }
}

function renderStatus() {
  $('#dev-status').innerHTML = device.status === 'running'
    ? '<span class="badge ok">running</span>'
    : `<span class="badge warn">${device.status}</span>`;
}

// ---- root ----
let rooting = false;
async function pollRoot() {
  const d = await api(`/api/instances/${id}`);
  if (!d || d.error) return;
  device = d;
  const s = $('#root-status');
  if (d.rootState === 'rooted') {
    s.innerHTML = '✅ Rooted (Magisk). su works now; the Magisk app installs itself a few seconds after boot — open it to enable Zygisk, then install LSPosed/Vector.';
    $('#root-btn').disabled = false;
    $('#root-btn').textContent = '⚡ Re-root (Magisk)';
    rooting = false;
  } else if (d.rootState === 'rooting') {
    s.textContent = '⏳ Rooting… building a Magisk image and rebooting the device (can take a few minutes).';
    $('#root-btn').disabled = true;
    rooting = true;
    setTimeout(pollRoot, 4000);
  } else if (d.rootState === 'failed') {
    s.innerHTML = '❌ Root failed. See <code>docker logs</code> for the rooter, or retry.';
    $('#root-btn').disabled = false;
    rooting = false;
  } else {
    s.textContent = 'Adds Magisk so you can install LSPosed/Vector and use su. Keeps your apps & data.';
  }
}

$('#root-btn').addEventListener('click', async () => {
  if (rooting) return;
  if (!confirm('Root this device with Magisk?\n\nIt builds a Magisk-injected image for this Android version and reboots the device. Your /data (apps & settings) is preserved.')) return;
  $('#root-btn').disabled = true;
  $('#root-status').textContent = '⏳ Starting root…';
  try {
    await api(`/api/instances/${id}/root`, { method: 'POST' });
    rooting = true;
    setTimeout(pollRoot, 3000);
  } catch (e) {
    $('#root-status').textContent = 'Error: ' + (e.message || e);
    $('#root-btn').disabled = false;
  }
});

// ---- events ----
$('#players').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-player]');
  if (!b) return;
  currentPlayer = b.dataset.player;
  loadStream();
});
$('#fit-toggle').addEventListener('change', (e) => { fit = e.target.checked; loadStream(); });
document.querySelectorAll('button[data-tool]').forEach((b) =>
  b.addEventListener('click', () => openTool(b.dataset.tool)));
$('#tool-close').addEventListener('click', () => {
  $('#tool-panel').classList.add('hidden');
  $('#tool-frame').src = 'about:blank';
});
// Re-check state first: the device may have been rebooted/stopped meanwhile.
$('#reload-stream').addEventListener('click', async () => {
  $('#stream-frame').src = 'about:blank';
  device = await api(`/api/instances/${id}`);
  renderStatus();
  if (!device.booted && !(await waitUntilBooted())) return;
  loadStream();
});

// ---- Magisk modules / safe mode ----
async function renderModules() {
  const r = await api(`/api/instances/${id}/modules`);
  const list = $('#mod-list');
  if (!r.rooted) { list.innerHTML = '<p class="msg">This device isn’t rooted — no Magisk modules.</p>'; return; }
  if (!r.modules.length) { list.innerHTML = '<p class="msg">No modules installed.</p>'; return; }
  list.innerHTML = r.modules.map((m) => `
    <div class="st-row">
      <span><strong>${m.name}</strong> ${m.version ? `<span class="muted">${m.version}</span>` : ''}
        ${m.enabled ? '' : '<span class="badge idle">disabled</span>'}
        <br /><code class="muted">${m.id}</code></span>
      <span>
        <button data-mod-toggle="${m.id}" data-on="${m.enabled ? 0 : 1}">${m.enabled ? 'Disable' : 'Enable'}</button>
        <button data-mod-remove="${m.id}" class="danger">Remove</button>
      </span>
    </div>`).join('');
}
async function afterModuleChange(promise) {
  $('#mod-msg').innerHTML = '<span class="spinner"></span> Applying and rebooting the device…';
  $('#stream-frame').src = 'about:blank';
  try {
    await promise;
    $('#mod-msg').textContent = '✅ Done — device is rebooting.';
    await renderModules();
    device = await api(`/api/instances/${id}`);
    if (!device.booted) await waitUntilBooted();
    loadStream();
  } catch (e) { $('#mod-msg').textContent = '❌ ' + (e.message || e); }
}
$('#modules-btn').addEventListener('click', async () => {
  $('#mod-name').textContent = device ? device.name : '';
  $('#mod-msg').textContent = '';
  $('#modules-modal').classList.remove('hidden');
  await renderModules();
});
$('#mod-close').addEventListener('click', () => $('#modules-modal').classList.add('hidden'));
$('#mod-list').addEventListener('click', (e) => {
  const t = e.target.closest('button[data-mod-toggle]');
  const rm = e.target.closest('button[data-mod-remove]');
  if (t) afterModuleChange(api(`/api/instances/${id}/modules/${t.dataset.modToggle}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: t.dataset.on === '1' }),
  }));
  else if (rm && confirm(`Remove module "${rm.dataset.modRemove}"? The device will reboot.`)) {
    afterModuleChange(api(`/api/instances/${id}/modules/${rm.dataset.modRemove}`, { method: 'DELETE' }));
  }
});
const doSafeMode = () => {
  if (!confirm('Safe mode: disable ALL Magisk modules and reboot?\n\nUse this if the device is stuck after installing a module.')) return;
  $('#modules-modal').classList.remove('hidden');
  $('#mod-name').textContent = device ? device.name : '';
  afterModuleChange(api(`/api/instances/${id}/safe-mode`, { method: 'POST' }));
};
$('#mod-safe').addEventListener('click', doSafeMode);
$('#safemode-btn').addEventListener('click', doSafeMode);

// ---- Remote ADB modal ----
let remote = null;
const LOCAL_ADB_PORT = 15037; // local tunnel port; avoids clashing with a local adb server (5037)
function renderRemoteCmds() {
  if (!remote) return;
  const host = $('#rm-host').value.trim() || remote.host;
  const user = $('#rm-user').value.trim() || 'USER';
  const sshPort = $('#rm-sshport').value.trim() || '22';
  const lp = LOCAL_ADB_PORT;
  const serial = remote.serial;
  $('#rm-tunnel').textContent =
    `ssh -N -L ${lp}:127.0.0.1:${remote.adbServerPort} ${user}@${host} -p ${sshPort}`;
  $('#rm-use').textContent =
    `export ANDROID_ADB_SERVER_PORT=${lp}\n` +
    `adb devices                       # lists ${serial}\n` +
    `adb -s ${serial} shell getprop ro.build.version.release\n` +
    `adb -s ${serial} install app.apk  # e.g. Claude Code testing your app`;
}
async function openRemote() {
  remote = await api(`/api/instances/${id}/remote`);
  $('#rm-name').textContent = device ? device.name : '';
  $('#rm-host').value = remote.host || remote.autodetectedHost || '';
  $('#rm-user').value = remote.sshUser || '';
  $('#rm-sshport').value = remote.sshPort || 22;
  renderRemoteCmds();
  $('#remote-modal').classList.remove('hidden');
}
$('#remote-btn').addEventListener('click', openRemote);
$('#rm-close').addEventListener('click', () => $('#remote-modal').classList.add('hidden'));
['rm-host', 'rm-user', 'rm-sshport'].forEach((el) =>
  $('#' + el).addEventListener('input', renderRemoteCmds));
document.querySelectorAll('.copy-btn').forEach((b) =>
  b.addEventListener('click', () => {
    navigator.clipboard.writeText($('#' + b.dataset.copy).textContent).then(() => {
      const t = b.textContent; b.textContent = 'Copied ✓';
      setTimeout(() => { b.textContent = t; }, 1200);
    });
  }));

// ---- upload (drag & drop / click): .apk installs, anything else is pushed ----
const s = () => $('#apk-status');
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';

async function uploadOne(file) {
  const isApk = /\.apk$/i.test(file.name);
  const verb = isApk ? 'Installing' : 'Uploading';
  s().textContent = `⏳ ${verb} ${file.name} (${mb(file.size)})…`;
  const url = isApk
    ? `/api/instances/${id}/install`
    : `/api/instances/${id}/push?name=${encodeURIComponent(file.name)}`;
  const r = await fetch(url, { method: 'POST', body: file });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || r.statusText);
  return isApk ? `Installed ${file.name}` : `Uploaded ${file.name} → ${body.remotePath}`;
}

async function handleFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const results = [];
  for (const f of files) {
    try { results.push('✅ ' + await uploadOne(f)); }
    catch (e) { results.push('❌ ' + f.name + ': ' + (e.message || e)); }
  }
  s().innerHTML = results.join('<br>');
}

const drop = $('#apk-drop');
const fileInput = $('#apk-input');
drop.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => handleFiles(fileInput.files));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault(); drop.classList.remove('drag');
}));
drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));

boot();
