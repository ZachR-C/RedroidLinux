# Builds ws-scrcpy (web-based scrcpy) from source. Provides the in-browser
# H.264 stream + touch/keyboard control the manager's "View" button opens.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git python3 make g++ android-tools-adb \
 && update-ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Pin to a commit/tag for reproducibility; bump deliberately when you want updates.
ARG WS_SCRCPY_REF=master
RUN git clone --depth 1 --branch "${WS_SCRCPY_REF}" https://github.com/NetrisTV/ws-scrcpy.git .

RUN npm install && npm run dist

EXPOSE 8000
# The production build lands in dist/; serve it.
CMD ["node", "dist/index.js"]
