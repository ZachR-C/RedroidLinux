# 02 · Provision redroid + run the manager (inside the VM)

Run these inside the Ubuntu VM, from the project directory.

## 1. Provision the host
```bash
cd ~/RedroidUbuntuServer
./provision/setup.sh
```
This installs Docker, adb, Node 20, loads `binder_linux`/`ashmem_linux`, and
persists them across reboots. **Log out/in** afterwards (or `newgrp docker`) so
`docker` works without `sudo`.

Verify the kernel side is healthy:
```bash
mountpoint /dev/binderfs                                    # should say "is a mountpoint"
ls -l /dev/binderfs/binder /dev/binderfs/hwbinder /dev/binderfs/vndbinder
lsmod | grep binder
```
Ubuntu 24.04's stock 6.8 kernel is **binderfs-only** — it does *not* create the
legacy static `/dev/binder` nodes, so the old `modprobe binder_linux devices=…`
trick creates nothing. `setup.sh` instead loads `binder_linux` and mounts
binderfs at `/dev/binderfs` (persisted in `/etc/fstab`); redroid's own init wires
up `/dev/binder` from there. If the mount is missing:
`sudo mount -t binder binder /dev/binderfs`.

## 2. (Optional) Pre-pull redroid images
Images are **pulled on demand** the first time you create a device with a given
Android version, so you can skip this. Pre-pull only if you want the first
device to start faster:
```bash
./provision/pull-images.sh   # optional; on-demand pulling is the default
```

## 3. Start the stack
```bash
docker compose up -d --build      # backend :8080 + ws-scrcpy :8000
```
Open **http://<vm-ip>:8080** from your Mac's browser.

> Prefer running without containers while iterating?
> ```bash
> cd backend && npm install && npm start      # manager on :8080
> # separately, install & run ws-scrcpy on :8000 (see its repo)
> ```

## 4. Smoke-test redroid by hand (optional but recommended)
Confirms the kernel/modules work before involving the webapp:
```bash
docker run -itd --privileged --name smoketest \
  -v /dev/binderfs:/dev/binderfs \
  -v ~/redroid-smoke:/data -p 5555:5555 \
  redroid/redroid:13.0.0_64only-latest \
  androidboot.redroid_gpu_mode=guest
sleep 35
adb connect 127.0.0.1:5555
adb -s 127.0.0.1:5555 shell getprop sys.boot_completed   # want: 1
docker rm -f smoketest
```
`1` means Android booted. Note two things baked into this command (and the app):
the **`_64only`** image (Apple Silicon has no 32-bit ARM mode, so mixed images
reboot-loop on a BoringSSL self-test), and mounting **`/dev/binderfs`** (this
kernel is binderfs-only). If it never reaches `1`, check `docker logs smoketest`
and `sudo dmesg | grep -iE 'boringssl|vold|shutdown_command'`.

➡️ Architecture & how streaming works: [03-architecture.md](03-architecture.md).
