# balenaCloud picks the correct base image per device architecture automatically
# when using balena's %%BALENA_MACHINE_NAME%% templating, but a plain Node LTS
# image on Debian works fine for Raspberry Pi 4 (arm64) via balenaOS's
# multi-arch support. Adjust the tag if targeting armv7 (Pi 3 or older).
FROM node:20-bookworm-slim

# sharp needs libvips; the slim base doesn't include it
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src
RUN npm install typescript --no-save && npx tsc

CMD ["node", "dist/index.js"]
