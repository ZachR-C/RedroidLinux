#!/usr/bin/env bash
# Pull the redroid ARM64 Android images the manager offers by default.
# Native arm64 => virtualization, no ARM->x86 translation. Run inside the VM.
#
# We use the _64only variants: Apple Silicon has no 32-bit ARM (AArch32) mode,
# so the standard mixed 32/64 images crash their 32-bit BoringSSL self-test at
# boot and reboot-loop. The 64-bit-only images avoid that.
set -euo pipefail

IMAGES=(
  "redroid/redroid:13.0.0_64only-latest"
  "redroid/redroid:12.0.0_64only-latest"
)

for img in "${IMAGES[@]}"; do
  echo "==> Pulling $img (linux/arm64)"
  docker pull --platform=linux/arm64 "$img"
done

echo "Done. Available redroid images:"
docker images | grep -E 'redroid' || true
