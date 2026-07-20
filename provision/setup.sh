#!/usr/bin/env bash
#
# One-shot provisioning for an Ubuntu Server 24.04 LTS (ARM64) VM to run
# the ReDroid manager stack. Run this INSIDE the Ubuntu VM, not on macOS.
#
#   chmod +x provision/setup.sh
#   ./provision/setup.sh
#
# Idempotent-ish: safe to re-run. Requires sudo.
set -euo pipefail

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[err] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ]   || die "Run this inside the Ubuntu VM (Linux), not on macOS."
[ "$(uname -m)" = "aarch64" ] || warn "Expected aarch64 (ARM64). Got $(uname -m) — redroid arm64 images may not run natively."

# ---------------------------------------------------------------------------
log "Updating apt and installing base packages"
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl git android-tools-adb

# ---------------------------------------------------------------------------
log "Installing Docker (official convenience script)"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
else
  echo "Docker already installed: $(docker --version)"
fi
# Let the current user run docker without sudo (takes effect on next login).
sudo usermod -aG docker "$USER" || true

# ---------------------------------------------------------------------------
log "Setting up binder (via binderfs) for redroid"
# Ubuntu 24.04's stock 6.8 kernel builds binder as a module WITHOUT the legacy
# static /dev/binder device nodes — it only supports binderfs. So instead of the
# old `modprobe binder_linux devices=...` trick (which silently creates no nodes
# on this kernel), we load the module and mount binderfs. redroid's own init
# then wires up /dev/binder from the mounted binderfs directory.
sudo apt-get install -y "linux-modules-extra-$(uname -r)" || \
  warn "linux-modules-extra-$(uname -r) not found — you may be on a custom/HWE kernel. See docs/02-redroid-setup.md."

sudo modprobe binder_linux || die "modprobe binder_linux failed"
echo 'binder_linux' | sudo tee /etc/modules-load.d/redroid.conf >/dev/null

# Mount binderfs now and persist it via fstab so it survives reboots.
sudo mkdir -p /dev/binderfs
if ! mountpoint -q /dev/binderfs; then
  sudo mount -t binder binder /dev/binderfs || die "failed to mount binderfs"
fi
grep -q '/dev/binderfs' /etc/fstab || \
  echo 'binder /dev/binderfs binder nosuid,nodev 0 0' | sudo tee -a /etc/fstab >/dev/null

# ---------------------------------------------------------------------------
log "Installing Node.js 20 LTS (for the manager backend + ws-scrcpy)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -c2 | tr -d '\n')" -lt 2 ] 2>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
echo "Node: $(node -v)  npm: $(npm -v)"

# ---------------------------------------------------------------------------
log "Verifying binderfs devices exist"
ls -l /dev/binderfs/binder /dev/binderfs/hwbinder /dev/binderfs/vndbinder 2>/dev/null || \
  warn "binderfs nodes missing — redroid will fail. Check 'mount | grep binder' and 'dmesg | grep binder'."

log "Provisioning complete."
cat <<'EOF'

Next:
  1) Log out / back in (so 'docker' works without sudo), or run: newgrp docker
  2) Pull a redroid image:      ./provision/pull-images.sh
  3) Start the manager stack:   docker compose up -d --build
     (or run backend directly:  cd backend && npm install && npm start)

EOF
