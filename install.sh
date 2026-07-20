#!/usr/bin/env bash
#
# One-command installer for ReDroid Manager. Run this ON THE UBUNTU VM:
#
#   curl -fsSL https://raw.githubusercontent.com/ZachR-C/RedroidLinux/main/install.sh | bash
#
# Clones/updates the repo, provisions the host (Docker, binder/ashmem kernel
# modules, adb, Node), pulls redroid images, and starts the manager stack.
# Safe to re-run (idempotent-ish) to update an existing install.
set -euo pipefail

REPO_URL="https://github.com/ZachR-C/RedroidLinux.git"
INSTALL_DIR="${INSTALL_DIR:-$HOME/RedroidLinux}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[err] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "Run this on the Ubuntu VM, not on macOS."

# ---------------------------------------------------------------------------
log "Fetching RedroidLinux into $INSTALL_DIR"
if [ -d "$INSTALL_DIR/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  command -v git >/dev/null 2>&1 || { sudo apt-get update -y && sudo apt-get install -y git; }
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------------------------------------------------------------------------
log "Running host provisioning (Docker, binder/ashmem, adb, Node)"
chmod +x provision/*.sh
./provision/setup.sh

REST_CMD="cd '$INSTALL_DIR' && ./provision/pull-images.sh && docker compose up -d --build"

# A freshly-added docker group membership only applies to new shells/logins.
# `sg docker` runs the rest of the install with that group active right now,
# so the user doesn't have to log out just to finish.
if groups | grep -qw docker; then
  log "Pulling redroid images (arm64) and starting the stack"
  bash -c "$REST_CMD"
elif command -v sg >/dev/null 2>&1; then
  log "Applying new 'docker' group membership for this session"
  sg docker -c "$REST_CMD"
else
  log "Docker group membership is new — log out/in, then run:"
  echo "  $REST_CMD"
  exit 0
fi

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

────────────────────────────────────────────────────────
 ReDroid Manager is up.
   UI:         http://${IP}:8080
   ws-scrcpy:  http://${IP}:8000
   Repo dir:   ${INSTALL_DIR}

 Re-run this installer any time to update:
   curl -fsSL https://raw.githubusercontent.com/ZachR-C/RedroidLinux/main/install.sh | bash
────────────────────────────────────────────────────────
EOF
