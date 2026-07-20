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
- Streaming deep-link: `http://<host>:8000/#!action=stream&udid=127.0.0.1:<port>&player=broadway`.

## Known gaps / TODO ideas
- No auth on the API or ws-scrcpy — keep on private network; add a
  reverse proxy + auth before any VPS exposure.
- Binderfs mount + module load are set up idempotently by `provision/setup.sh`
  and persisted (fstab + modules-load.d) so they survive VM reboots.
- Possible next features: per-device APK install/uninstall, device cloning,
  resolution presets, a nicer live-status UI.
