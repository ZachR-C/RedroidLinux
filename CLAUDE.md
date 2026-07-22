# CLAUDE.md — working notes for this project

Context for future Claude Code sessions working on **RedroidLinux**
(github.com/ZachR-C/RedroidLinux).

## What this is
A web app + orchestration layer to run **virtualized Android** instances
(redroid) on an Ubuntu Server ARM64 VM (UTM, on an Apple M2 Mac), with
in-browser manual control via ws-scrcpy. Designed to also lift to a VPS later.

## The deployment target
- **VM:** Ubuntu Server 24.04.4 LTS, ARM64, kernel 6.8, running in UTM on an M2.
- **SSH access:** `ssh redroidvm` (config in `~/.ssh/config`, key
  `~/.ssh/id_ed25519_redroidvm`). User `zach` has passwordless sudo.
- **VM IP:** 192.168.64.8 (UTM NAT — may change if the VM/network resets).
- **Repo on VM:** `~/RedroidLinux`. Stack runs via `docker compose up -d`.

## Development workflow (IMPORTANT)
The user wants changes tested on the real VM, not just locally:
1. Edit code locally on the Mac.
2. Commit + push to GitHub (`main`).
3. `ssh redroidvm 'cd ~/RedroidLinux && git pull && docker compose up -d --build'`.
4. Test over SSH: hit the API on `localhost:8080`, `docker logs`, `sudo dmesg`,
   `adb -s 127.0.0.1:<port> shell ...`. Read real logs; don't guess.
5. Keep this file and the GitHub repo updated as things change.

## Hard-won platform facts (do not regress these)
- **Use `_64only` redroid image tags.** Apple Silicon has NO 32-bit ARM
  (AArch32) execution mode. The standard mixed 32/64 images crash their 32-bit
  BoringSSL self-test at boot ("Exec format error") and Android's
  `reboot_on_failure` policy reboot-loops the container forever. `_64only`
  images avoid this. (Only `13.0.0_64only` and `12.0.0_64only` exist upstream —
  there is no `11.0.0_64only`.)
- **This kernel is binderfs-only.** Ubuntu 24.04's stock 6.8 kernel builds
  `binder_linux` WITHOUT legacy static `/dev/binder` nodes. The old
  `modprobe binder_linux devices=binder,hwbinder,vndbinder` trick silently
  creates nothing. Instead: load `binder_linux`, `mount -t binder binder
  /dev/binderfs` (persisted in `/etc/fstab`), and bind-mount the whole
  `/dev/binderfs` dir into each redroid container. redroid's own init wires up
  `/dev/binder` from it. Mapping individual device nodes causes an early-boot
  race that aborts `vold` → `reboot,vold-failed`.
- **GPU:** `androidboot.redroid_gpu_mode=guest` (software render). No GPU
  passthrough in the VM. Fine for management/testing, not heavy 3D.
- Debugging boot failures: `sudo dmesg | grep -iE 'boringssl|vold|shutdown_command'`
  and look for `Got shutdown_command 'reboot,<reason>'`.

## Architecture quick ref
- `backend/` Node/Express/dockerode — REST API + serves the UI. One redroid
  container per device; `/data` on a host volume; unique published ADB port.
- `ws-scrcpy/` — built from source; H.264 stream + input in the browser.
- Both compose services use `network_mode: host` so they SHARE one host adb
  server — backend does `adb connect 127.0.0.1:<port>`, ws-scrcpy then sees it.
- **Streaming — the working direct URL** (reverse-engineered from ws-scrcpy
  0.9.x `BaseDeviceTracker.buildLink` + `StreamClientScrcpy`). There is no
  "player=broadway" shortcut; you must include the `ws=` proxy URL yourself:
  ```
  http://<host>:8000/#!action=stream&udid=<serial>&player=<code>&ws=<proxyWs>
  proxyWs = ws://<host>:8000/?action=proxy-adb&remote=tcp:8886&udid=<serial>
  ```
  `8886` = scrcpy SERVER_PORT (Constants.ts). Player codes: `broadway`
  (Broadway.js), `mse` (H264 Converter), `tinyh264` (Tiny H264). Omitting `ws`
  => `Missing required parameter "ws"` => white screen (the old bug).
  Tool URLs are simpler — just `#!action=<a>&udid=<serial>` for
  `shell` / `devtools` / `list-files`. `frontend/device.js` builds all of these;
  the "View" button opens `/device.html?id=…` which auto-streams + sidebar.
  Verified: the proxy-adb ws opens and streams device data headlessly.
- **Images pull on demand** at create time (`ensureImage` in instances.js,
  `platform: linux/arm64`), so the app can offer all Android 10–16 (full +
  _64only) without pre-downloading ~24GB. Only _64only boots on Apple Silicon.
- `frontend/` is bind-mounted into the backend container (`./frontend:/frontend:ro`),
  so UI edits need only `docker compose restart backend`, not a rebuild.

## One-click root (Magisk) — verified working
- `POST /api/instances/:id/root` → backend sets `rootState=rooting`, launches the
  one-shot **`redroid-rooter`** image (built from `rooter/`, under compose profile
  `rooter`; the backend starts it via the Docker API with the docker.sock
  mounted), which runs `rooter/root-device.py`. That reuses
  ayasa520/redroid-script's Magisk file-prep and builds `FROM <device image> ;
  COPY magisk /` → `<repo>:<tag>_magisk`. Building `FROM` the device's own image
  ourselves is why it roots the `_64only` tags (redroid-script's own version list
  has no `_64only` for 13/14/16).
- Backend then recreates the device container on the `_magisk` image (same
  `/data`, port, geometry), starts it, sets `rootState=rooted`, and best-effort
  installs the Magisk manager apk (`ensureMagiskApp`) once booted.
- **Magisk pinned to v30.6** via `rooter/Dockerfile` ARG `REDROID_SCRIPT_REF`
  (redroid-script commit 881f7f0). The later v30.7 bump changed the manager APK
  signature, which trips magiskd's anti-tamper check under redroid (`APK
  signature mismatch` → `pm_uninstall`), so the app crashed + self-deleted on
  first launch (upstream issues #74/#76). v30.6 (`30.6:MAGISK:D`) matches, app
  is stable. If you ever bump the ref, re-verify the app survives launch.
- Verified on Android 13 `_64only`: `su 0 id` → uid=0(root), `magiskd` running,
  manager app `com.topjohnwu.magisk` (v30.6) launches, survives, and spawns a
  `:root:0` subprocess (i.e. Magisk grants it root — Zygisk/LSPosed will work).
- The rooter needs internet (downloads Magisk from GitHub) and the docker socket.
  Rebuild it after changing `rooter/`: `docker compose --profile rooter build rooter`.

## Remote ADB (from another computer) — verified
- `GET /api/instances/:id/remote` returns `{serial, adbPort, host, sshUser,
  sshPort, adbServerPort:5037}`. The device serial is `127.0.0.1:<adbPort>` as
  seen on the server.
- The working method (device console → "Connect from another computer"): SSH-
  tunnel the host's **adb server** and drive it as a client — NOT the raw device
  port:
  ```
  ssh -N -L 15037:127.0.0.1:5037 <user>@<host>
  export ANDROID_ADB_SERVER_PORT=15037
  adb devices                       # shows 127.0.0.1:<adbPort>
  adb -s 127.0.0.1:<adbPort> shell ...
  ```
- WHY not tunnel the raw device port: redroid's adbd allows only one adb server
  transport, and the host's adb server (shared by ws-scrcpy + management) already
  holds it — a second server via the raw port gets `device offline` / protocol
  reset. Tunnelling 5037 shares that one server, so it coexists. Verified from a
  separate machine (the Mac) against the VM. One tunnel exposes all emulators.
- Config `PUBLIC_HOST` / `SSH_USER` / `SSH_PORT` prefill the UI (host auto-detects
  via host-network interfaces). Requires matching-ish adb versions on both ends.

## Storage model (kept lean)
- **On-demand images**: `install.sh` pulls NO Android images; `ensureImage()`
  pulls each version the first time a device uses it. A fresh install/VPS carries
  no multi-GB images until needed. `provision/pull-images.sh` is optional warm-up.
- **Per-instance cost is small**: base image (~2 GB) is a shared read-only layer
  across every device on that version; each `/data` volume is ~25–250 MB.
- **Root images**: one stable `<base>_magisk` tag per version (root builds FROM
  the tracked `baseImage`, never FROM a rooted image — avoids `_magisk_magisk`).
  Re-root replaces the tag; the old image + danglers are auto-pruned. Deleting a
  device reclaims its `_magisk` image if unreferenced. Base `-latest` images are
  left for re-pull on demand.
- Measured density: ~0.7 GB RAM per running idle instance (Android 14, 720p).

## Magisk modules / bad-module recovery
- Modules live at `<dataPath>/adb/modules/<id>/` on the host volume, so the
  backend manages them directly with `fs` (works even mid-bootloop). A `disable`
  file makes Magisk skip a module; deleting the dir removes it. Changes apply on
  reboot, so mutations call `restartDevice()`.
- Endpoints: `GET/POST/DELETE /:id/modules[/:mid]`, `POST /:id/safe-mode`
  (disable ALL + reboot). Device console has "Manage modules" + a "Safe mode"
  button (also reachable while a device is bootlooping — View opens whenever
  running; the console shows the boot spinner, only streams once booted).
- **Integrity/attestation modules bootloop redroid.** Isolated by testing on a
  14_64only_gapps_magisk device (Magisk Delta 30.6): Zygisk ALONE (Delta
  built-in, no modules) boots fine; PIF/Integrity-Box + Zygisk (built-in OR
  ZygiskNext) ALWAYS bootloops; PIF with Zygisk off boots but its GMS hooking is
  inactive. => the crash is Integrity-Box's own Zygisk injection into GMS
  faulting in the container, NOT a Zygisk/ZygiskNext conflict and not Zygisk
  being unsupported. Enable Delta's built-in Zygisk via
  `sqlite3 <dataPath>/adb/magisk.db "REPLACE INTO settings VALUES('zygisk',1)"`.
  Even if it loaded, redroid CANNOT pass DEVICE/STRONG Play Integrity (no TEE/HW
  keymaster attestation — cryptographic, not fixable); BASIC via prop-spoofing
  only, unreliably. So these modules are a dead end on redroid. Zygisk itself is
  fine (LSPosed works). To authorize adb on a not-fully-booted device for
  debugging, write an adb pubkey to `<dataPath>/misc/adb/adb_keys` and restart.
- `booted` flag = `getprop sys.boot_completed`, cached per container run
  (id+StartedAt). It gates streaming so scrcpy never connects before the display
  stack exists (that produced a permanent grey view).

## Known gaps / TODO ideas
- No auth on the API or ws-scrcpy — keep on private network; add a
  reverse proxy + auth before any VPS exposure.
- Binderfs mount + module load are set up idempotently by `provision/setup.sh`
  and persisted (fstab + modules-load.d) so they survive VM reboots.
- Possible next features: per-device APK install/uninstall, device cloning,
  resolution presets, a nicer live-status UI.
