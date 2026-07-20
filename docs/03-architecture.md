# 03 · Architecture

```
   Your Mac (browser)
        │  http :8080 (UI + API)      http :8000 (stream, in <iframe>)
        ▼
┌─────────────────────────── Ubuntu VM (ARM64, virtualized on M2) ──────────────┐
│                                                                                │
│   backend (Node/Express/dockerode)          ws-scrcpy (Node)                   │
│     • REST API + serves the UI                • H.264 stream + touch/keyboard   │
│     • create/start/stop/delete                • reads the shared adb server     │
│     • adb connect 127.0.0.1:<port>  ─────────────────┐                          │
│        (shared host adb server, network_mode: host)  │                          │
│               │ Docker socket                        │ adb                      │
│               ▼                                       ▼                          │
│   ┌── redroid_ab12 ──┐   ┌── redroid_cd34 ──┐   ... (one container per device)  │
│   │ Android 13 (arm64)│   │ Android 12       │                                   │
│   │ /data → host vol  │   │ /data → host vol │                                   │
│   │ 5555 → :5555      │   │ 5555 → :5556     │   ← published on 127.0.0.1        │
│   └───────────────────┘   └──────────────────┘                                  │
│        binder_linux / ashmem_linux  (host kernel, shared — this is why it's     │
│        containerization, not emulation)                                         │
└────────────────────────────────────────────────────────────────────────────────┘
```

## Why this is "as real as possible"
- **Guest = virtualization:** ARM64 Ubuntu on ARM64 M2 → native instructions.
- **Android = containerization:** redroid runs the real Android userspace against
  the host's Linux kernel via `binder`/`ashmem`. No per-app CPU emulation, no
  QEMU device model. Closer to bare metal than the AVD emulator.
- **Native arm64 images:** no ARM→x86 app translation layer.

## What each "device" is
One privileged Docker container + one host `/data` folder + one published ADB
port. Metadata (name, image, resolution, port, data path) lives in
`instances.json`; Docker is the source of truth for running/stopped. Because
`/data` is a host volume, a stopped or deleted-but-kept device retains its apps
and state.

## The streaming path (manual, non-headless use)
redroid is headless — it only exposes ADB. To *see and touch* a device:
1. Manager starts the container and runs `adb connect 127.0.0.1:<port>`.
2. Both manager and ws-scrcpy use `network_mode: host`, so they share **one** adb
   server — ws-scrcpy immediately sees the connected device.
3. The UI's **View** button opens ws-scrcpy's player for that serial in an
   `<iframe>` (`#!action=stream&udid=127.0.0.1:<port>&player=broadway`),
   giving live video + mouse/keyboard control in the browser.

Players: `broadway` (pure-JS H.264, most compatible) or `mse` (hardware-assisted,
lower latency where supported). Change the default in `frontend/app.js:streamUrl`.

## Moving to a VPS later
Nothing here is Mac-specific. On any ARM64 (or x86_64, using x86 redroid images)
Linux host with the binder modules, the same `docker compose up` works. Put a
reverse proxy (Caddy/nginx) with auth + TLS in front of :8080 and :8000 before
exposing it publicly — **there is no authentication built in yet** (see README
security note).
