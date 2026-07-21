# ReDroid Manager

A web app + orchestration layer to run **virtualized Android instances** on a
Linux VM (Ubuntu Server ARM64 on an Apple M2) and drive each one manually from
your browser — create, start/stop, save, delete, and **View** (live screen +
touch/keyboard) via ws-scrcpy.

> **Virtualization, not emulation, end to end.** The VM runs native ARM64 on the
> M2; redroid runs the real Android userspace as a container against the host
> Linux kernel (`binder`/`ashmem`). No per-instruction CPU emulation. See
> [docs/03-architecture.md](docs/03-architecture.md).

## What you get
- **Manager backend** (Node/Express/dockerode) — REST API + static UI.
- **Web UI** — create devices (name, image, resolution, dpi, fps), start/stop,
  delete (optionally wiping `/data`), and open a live stream.
- **ws-scrcpy** — in-browser H.264 stream + input for hands-on, non-headless use.
- **Provisioning scripts** for the Ubuntu VM (Docker, kernel modules, adb, Node).
- **docker-compose** to bring the whole stack up with one command.

## The one manual step
Creating the UTM VM and installing Ubuntu is interactive and can't be scripted
from macOS. Do that first, then everything else is `./setup.sh` + `docker compose up`.

## Quick start
1. **Create the VM** → [docs/01-vm-setup.md](docs/01-vm-setup.md)
   (Ubuntu Server 24.04 LTS ARM64 in UTM, 8 GB / 4 cores / 64 GB).
2. **Install everything with one command**, run inside the VM:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/ZachR-C/RedroidLinux/main/install.sh | bash
   ```
   This clones the repo, provisions the host (Docker, binder/ashmem kernel
   modules, adb, Node), pulls the arm64 redroid images, and starts the manager
   stack. Re-run the same command any time to update to the latest version.
   > First run adds you to the `docker` group — if it stops partway asking you
   > to log out/in, do that once, then re-run the same command.
3. Open **http://<vm-ip>:8080** from your Mac → create a device → **Start** →
   wait for `running`/adb-online → **View**.

Prefer to do it step by step (or the repo is private and `curl` can't reach it
unauthenticated)? See [docs/02-redroid-setup.md](docs/02-redroid-setup.md).

## Repository layout
```
provision/         setup.sh (host prep) · pull-images.sh
backend/           Node API + orchestration
  src/config.js      env-driven config
  src/instances.js   container lifecycle (create/start/stop/remove)
  src/adb.js         adb connect/disconnect/status
  src/store.js       JSON persistence of instance metadata
  src/server.js      Express routes + serves the UI
  Dockerfile
frontend/          index.html · app.js · style.css  (vanilla, no build step)
ws-scrcpy/         Dockerfile (builds ws-scrcpy from source)
docker-compose.yml both services, host networking
docs/              01 VM setup · 02 redroid setup · 03 architecture
```

## API (for scripting / a future richer UI)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | image list, ws-scrcpy location |
| GET | `/api/instances` | list devices (+ live status, adb-online) |
| POST | `/api/instances` | create `{name,image,width,height,dpi,fps}` |
| POST | `/api/instances/:id/start` | start + `adb connect` |
| POST | `/api/instances/:id/stop` | `adb disconnect` + stop |
| DELETE | `/api/instances/:id?data=true` | remove container (`data=true` wipes `/data`) |
| POST | `/api/instances/:id/root` | build a Magisk image & recreate the device rooted (poll `rootState`) |
| POST | `/api/instances/:id/install` | install an APK — raw `.apk` bytes as the request body |
| POST | `/api/instances/:id/push?name=<file>` | upload any file — raw bytes in body; routed to Pictures/Movies/Music/Documents/Download by type |

## ⚠️ Security note (read before exposing it)
There is **no authentication** and the backend has full Docker socket access.
Keep it on the VM's private network / behind SSH. Before putting it on a VPS,
front :8080 and :8080 with a reverse proxy that adds TLS + auth, and restrict who
can reach ws-scrcpy. Treat `--privileged` redroid containers as trusted-only.

## Notes & limits
- **Software GPU** (`redroid_gpu_mode=guest`) — no GPU passthrough in the VM, so
  rendering is CPU-bound. Fine for management/testing; not for heavy 3D games.
- **ARM64 images** run apps built for ARM natively; some x86-only apps won't run
  (that's the tradeoff for "real"/native — no translation layer).
- Instance `/data` persists on the host across stop/start and across deletes
  unless you choose to wipe it.
