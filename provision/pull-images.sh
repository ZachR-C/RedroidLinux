#!/usr/bin/env bash
# Pull the redroid ARM64 Android images the manager offers by default.
# Native arm64 => virtualization, no ARM->x86 translation. Run inside the VM.
set -euo pipefail

IMAGES=(
  "redroid/redroid:13.0.0-latest"
  "redroid/redroid:12.0.0-latest"
  "redroid/redroid:11.0.0-latest"
)

for img in "${IMAGES[@]}"; do
  echo "==> Pulling $img (linux/arm64)"
  docker pull --platform=linux/arm64 "$img"
done

echo "Done. Available redroid images:"
docker images | grep -E 'redroid' || true
