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
  if (!device) return;
  const url = streamUrl(device.serial, currentPlayer);
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
  if (device.status !== 'running' || !device.adbOnline) {
    $('#side-msg').innerHTML =
      'Device is not online yet. <a href="/">Go back</a>, Start it, and wait for “running”.';
  }
  loadStream();
  pollRoot();
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
$('#reload-stream').addEventListener('click', loadStream);

boot();
