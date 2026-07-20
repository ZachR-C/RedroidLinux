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

# Patch: honor a "fit=1" URL param on the stream so our device console can
# toggle fit-to-screen from outside the (cross-origin) iframe. Without this
# there is no way to drive ws-scrcpy's internal fit setting remotely. The line
# is unique (the else-branch uses `query`, not `params`), so this sed is safe.
RUN sed -i \
  's#return new StreamClientScrcpy(params, streamReceiver, player, fitToScreen, videoSettings);#return new StreamClientScrcpy(params, streamReceiver, player, query.get("fit") === "1" ? true : fitToScreen, videoSettings);#' \
  src/app/googDevice/client/StreamClientScrcpy.ts \
 && grep -q 'query.get("fit")' src/app/googDevice/client/StreamClientScrcpy.ts

RUN npm install && npm run dist

EXPOSE 8000
# The production build lands in dist/; serve it.
CMD ["node", "dist/index.js"]
