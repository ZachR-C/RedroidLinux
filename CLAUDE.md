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
- Uses ayasa520's Magisk fork **v30.7** (bootless; Zygisk/LSPosed capable).
  Verified on Android 13 `_64only`: `su 0 id` → uid=0(root), `magiskd` running,
  Magisk 30.6, manager app `com.topjohnwu.magisk` installs.
- The rooter needs internet (downloads Magisk from GitHub) and the docker socket.
  Rebuild it after changing `rooter/`: `docker compose --profile rooter build rooter`.

## Known gaps / TODO ideas
- No auth on the API or ws-scrcpy — keep on private network; add a
  reverse proxy + auth before any VPS exposure.
- Binderfs mount + module load are set up idempotently by `provision/setup.sh`
  and persisted (fstab + modules-load.d) so they survive VM reboots.
- Possible next features: per-device APK install/uninstall, device cloning,
  resolution presets, a nicer live-status UI.
