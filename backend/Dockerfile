FROM node:20-bookworm-slim

# adb is required so we can `adb connect` each redroid container into the shared
# host adb server (which ws-scrcpy reads from).
RUN apt-get update \
 && apt-get install -y --no-install-recommends android-tools-adb \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/package.json ./
RUN npm install --omit=dev

COPY backend/ ./
# The static UI lives one level up in the repo; copy it where server.js expects it.
COPY frontend/ ../frontend/

EXPOSE 8080
CMD ["node", "src/server.js"]
