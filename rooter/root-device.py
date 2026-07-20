#!/usr/bin/env python3
"""Build a Magisk-injected redroid image.

Env:
  BASE_IMAGE    e.g. redroid/redroid:13.0.0_64only-latest
  OUTPUT_IMAGE  e.g. redroid/redroid:13.0.0_64only_magisk

Reuses redroid-script's Magisk file-prep (download the Magisk apk, extract the
arm64 libs, lay out ./magisk), then builds `FROM <base> ; COPY magisk /`. Doing
the FROM ourselves (instead of redroid.py) lets us root ANY base tag, including
the _64only images that are the only ones that boot on Apple Silicon.
"""
import os
import subprocess
import sys

sys.path.insert(0, "/opt/redroid-script")
os.chdir("/opt/redroid-script")

from stuff.magisk import Magisk  # noqa: E402

base = os.environ["BASE_IMAGE"]
out = os.environ["OUTPUT_IMAGE"]

print(f"[rooter] preparing Magisk files for {base}", flush=True)
Magisk().install()  # downloads + extracts + copies into ./magisk

with open("Dockerfile", "w") as f:
    f.write(f"FROM {base}\nCOPY magisk /\n")

print(f"[rooter] building {out}", flush=True)
subprocess.run(["docker", "build", "-t", out, "."], check=True)
print(f"[rooter] ROOT_BUILD_DONE {out}", flush=True)
