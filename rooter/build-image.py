#!/usr/bin/env python3
"""Build a customised redroid image (Magisk and/or MindTheGapps).

Env:
  BASE_IMAGE       e.g. redroid/redroid:13.0.0_64only-latest
  OUTPUT_IMAGE     e.g. redroid/redroid:13.0.0_64only_gapps
  MODULES          comma list: magisk,mindthegapps   (default: magisk)
  ANDROID_VERSION  redroid-script version key, e.g. 13.0.0_64only
                   (required for mindthegapps)

Reuses redroid-script's file-prep for each module, then builds
`FROM <base>` + a COPY layer per module. Doing the FROM ourselves (instead of
redroid.py) lets us build on ANY base tag — including the _64only images that
are the only ones that boot on Apple Silicon — and to stack modules onto an
already-customised image (e.g. Magisk on top of a GApps image).
"""
import os
import subprocess
import sys

sys.path.insert(0, "/opt/redroid-script")
os.chdir("/opt/redroid-script")

base = os.environ["BASE_IMAGE"]
out = os.environ["OUTPUT_IMAGE"]
modules = [m.strip() for m in os.environ.get("MODULES", "magisk").split(",") if m.strip()]
version = os.environ.get("ANDROID_VERSION", "")

lines = [f"FROM {base}"]

# Order matters: lay GApps down first, then Magisk on top.
if "mindthegapps" in modules:
    from stuff.mindthegapps import MindTheGapps
    if not version:
        sys.exit("ANDROID_VERSION is required for mindthegapps")
    # redroid-script only has _64only keys for 13/12, but the _64only images use
    # the identical arm64 GApps package as the full version — so fall back to the
    # base version key. That enables GApps on 14/15 _64only too.
    key = version if version in MindTheGapps.dl_links else version.replace("_64only", "")
    if key not in MindTheGapps.dl_links:
        sys.exit(f"MindTheGapps has no build for Android {version}")
    print(f"[builder] preparing MindTheGapps for {version} (using {key})", flush=True)
    MindTheGapps(key).install()
    lines.append("COPY mindthegapps /")

if "magisk" in modules:
    from stuff.magisk import Magisk
    print("[builder] preparing Magisk", flush=True)
    Magisk().install()
    lines.append("COPY magisk /")

if len(lines) == 1:
    sys.exit(f"no known modules in MODULES={modules!r}")

with open("Dockerfile", "w") as f:
    f.write("\n".join(lines) + "\n")

print(f"[builder] building {out} from {base} with {modules}", flush=True)
subprocess.run(["docker", "build", "-t", out, "."], check=True)
print(f"[builder] BUILD_DONE {out}", flush=True)
