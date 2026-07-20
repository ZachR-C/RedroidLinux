// Device console: auto-loads the live scrcpy stream for one instance and
// provides a sidebar to switch player / open ws-scrcpy tools.
//
// We construct the ws-scrcpy stream URL exactly the way ws-scrcpy's own device
// list does (StreamClientScrcpy + BaseDeviceTracker.buildLink):
//
//   http://<host>:<wsPort>/#!action=stream&udid=<serial>&player=<code>
//        &ws=<ws://<host>:<wsPort>/?action=proxy-adb&remote=tcp:8886&udid=<serial>>
//
// 8886 is the scrcpy server port (Constants.SERVER_PORT); ws-scrcpy auto-starts
// that server on every tracked device, so the URL works without visiting the
// device list first.
const $ = (s) => document.querySelector(s);
const api = (p) => fetch(p).then((r) => r.json());

const SCRCPY_SERVER_PORT = 8886;
const PLAYERS = [
  { code: 'broadway', name: 'Broadway.js' },
  { code: 'mse', name: 'H264 Converter' },
  { code: 'tinyh264', name: 'Tiny H264' },
];

const params = new URLSearchParams(location.search);
const id = params.get('id');

let cfg = { wsScrcpyPort: 8000 };
let device = null;
let currentPlayer = params.get('player') || 'broadway';

function wsHost() { return location.hostname; }
function wsPort() { return cfg.wsScrcpyPort || 8000; }

function proxyWs(serial) {
  return `ws://${wsHost()}:${wsPort()}/?action=proxy-adb`
    + `&remote=tcp:${SCRCPY_SERVER_PORT}&udid=${serial}`;
}

function streamUrl(serial, player) {
  const q = new URLSearchParams({
    action: 'stream', udid: serial, player, ws: proxyWs(serial),
  });
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
  $('#stream-frame').src = streamUrl(device.serial, currentPlayer);
  $('#open-tab').href = streamUrl(device.serial, currentPlayer);
  renderPlayers();
}

async function boot() {
  cfg = await api('/api/config');
  device = await api(`/api/instances/${id}`);
  if (!device || device.error) {
    $('#side-msg').textContent = 'Device not found.';
    return;
  }
  $('#dev-name').textContent = device.name;
  $('#dev-serial').textContent = device.serial;
  $('#dev-status').innerHTML = device.status === 'running'
    ? '<span class="badge ok">running</span>'
    : `<span class="badge warn">${device.status}</span>`;

  if (device.status !== 'running' || !device.adbOnline) {
    $('#side-msg').innerHTML =
      'Device is not online yet. <a href="/">Go back</a>, Start it, and wait for “running”.';
  }
  loadStream();
}

// ---- events ----
$('#players').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-player]');
  if (!b) return;
  currentPlayer = b.dataset.player;
  loadStream();
});

document.querySelectorAll('button[data-tool]').forEach((b) => {
  b.addEventListener('click', () => {
    if (!device) return;
    window.open(toolUrl(device.serial, b.dataset.tool), '_blank', 'noopener');
  });
});

$('#reload-stream').addEventListener('click', loadStream);

boot();
