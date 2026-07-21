# One-shot "rooter": injects Magisk into a redroid image using ayasa520's
# redroid-script (bootless: FROM <base> + COPY magisk /). Launched on demand by
# the backend via the Docker API; it talks to the host Docker daemon through the
# mounted socket and produces a <repo>:<tag>_magisk image.
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates lzip curl \
 && rm -rf /var/lib/apt/lists/*

# Docker CLI (client only) — talks to the mounted host socket for `docker build`.
ARG TARGETARCH=arm64
RUN set -eux; \
    case "$(uname -m)" in aarch64) A=aarch64 ;; x86_64) A=x86_64 ;; *) A="$(uname -m)" ;; esac; \
    curl -fsSL "https://download.docker.com/linux/static/stable/${A}/docker-27.3.1.tgz" -o /tmp/d.tgz; \
    tar -xzf /tmp/d.tgz -C /tmp; cp /tmp/docker/docker /usr/local/bin/docker; \
    rm -rf /tmp/d.tgz /tmp/docker

WORKDIR /opt
# Pin to the last commit that used Magisk v30.6. The later v30.7 bump changed the
# manager APK signature, which trips Magisk's anti-tamper check under redroid and
# makes the app crash + self-uninstall on first launch (ayasa520/redroid-script
# issues #74/#76). v30.6's apk + daemon signatures match, so the manager sticks.
ARG REDROID_SCRIPT_REF=881f7f00d6a86af4f8e4947af5d587a144a1806c
RUN git clone https://github.com/ayasa520/redroid-script.git \
 && git -C redroid-script checkout "${REDROID_SCRIPT_REF}"
RUN pip install --no-cache-dir -r redroid-script/requirements.txt

COPY root-device.py /opt/root-device.py

ENV USER=root XDG_CACHE_HOME=/tmp/cache
WORKDIR /opt/redroid-script
ENTRYPOINT ["python", "/opt/root-device.py"]
