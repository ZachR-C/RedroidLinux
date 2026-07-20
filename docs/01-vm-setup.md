# 01 · Create the Ubuntu VM in UTM (manual, on your Mac)

This is the one part that must be done by hand on macOS — it's an interactive
installer. ~20 minutes. Everything after this is scripted.

## Why these choices
- **UTM + Apple Virtualization / QEMU:** on an M2, an ARM64 guest runs
  *virtualized* (native instruction set), not emulated. Near-native speed.
- **Ubuntu Server 24.04 LTS ARM64:** its stock 6.8 kernel has prebuilt
  `binder_linux`/`ashmem_linux` in `linux-modules-extra` — the supported redroid
  path. Supported until 2029.

## Steps

1. **Download the ISO** — Ubuntu Server 24.04 LTS **for ARM** (`arm64`):
   <https://ubuntu.com/download/server/arm> (file like
   `ubuntu-24.04.x-live-server-arm64.iso`). Do **not** grab the amd64 ISO.

2. **New VM in UTM** → *Virtualize* → *Linux*.
   - Backend: **QEMU** is recommended (broadest device/module support). Apple
     Virtualization also works; if you hit odd module issues, switch to QEMU.
   - Boot ISO: select the downloaded file.
   - **Memory: 8192 MB** (6 GB floor), **CPU cores: 4**, **disk: 64 GB+**
     (each Android instance's `/data` can grow to several GB).
   - Enable a shared/NAT network (default) so the VM gets an IP.

3. **Install Ubuntu Server** with defaults. Two things to enable:
   - Create your user (remember the username).
   - Tick **“Install OpenSSH server”** — you'll want to SSH in from macOS.

4. **First boot** — eject the ISO in UTM settings so it boots from disk, then
   log in. Find the VM's IP:
   ```bash
   ip -4 addr show | grep inet
   ```

5. **SSH in from macOS** (nicer than the UTM console):
   ```bash
   ssh <username>@<vm-ip>
   ```

6. **Get this project onto the VM** — either:
   ```bash
   git clone <your-repo-url> RedroidUbuntuServer   # if you push it to git
   # ── or copy from the Mac ──
   # (run on the Mac):  scp -r "RedroidUbuntuServer" <username>@<vm-ip>:~/
   ```

➡️ Continue with [02-redroid-setup.md](02-redroid-setup.md).

## Sizing a multi-instance host
Each running redroid instance ≈ 1–2 GB RAM + 1 core under light use, software
GPU. For 3–4 concurrent devices bump the VM to 12–16 GB RAM / 6–8 cores. You can
resize the UTM VM later.
