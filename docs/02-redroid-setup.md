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
ls -l /dev/binder /dev/hwbinder /dev/vndbinder   # should exist
lsmod | grep -E 'binder|ashmem'
```
If `/dev/binder` is missing, you're likely on a non-stock/HWE kernel without the
legacy binder device. Fix: install the matching stock kernel + modules, or
`sudo modprobe binder_linux devices=binder,hwbinder,vndbinder` again and check
`dmesg | grep binder`. This is the known binderfs-only breakage — the
`linux-modules-extra` + `modprobe devices=` route avoids it.

## 2. Pull redroid images (native arm64)
```bash
./provision/pull-images.sh
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
  -v ~/redroid-smoke:/data -p 5555:5555 \
  redroid/redroid:13.0.0-latest \
  androidboot.redroid_gpu_mode=guest
sleep 25
adb connect 127.0.0.1:5555
adb -s 127.0.0.1:5555 shell getprop sys.boot_completed   # want: 1
docker rm -f smoketest
```
`1` means Android booted. If it never reaches `1`, check `docker logs smoketest`
and the binder notes above.

➡️ Architecture & how streaming works: [03-architecture.md](03-architecture.md).
