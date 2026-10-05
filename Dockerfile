# Trusted pipeline worker image.
#
# The worker does what a serverless web deployment cannot: claim jobs from the
# queue, scan originals with ClamAV, run local OCR, evaluate rules and write
# intermediate outputs. No secret is baked into the image; configuration comes
# from the environment (docker-compose.worker.yml passes .env.local).
FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

# Fontconfig is required by the canvas/native image pipeline; nothing else is.
RUN apt-get update \
  && apt-get install --no-install-recommends -y ca-certificates libfontconfig1 tini \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
COPY public/fonts ./public/fonts

ENV WORKER_POLL_MS=3000
USER node

ENTRYPOINT ["/usr/bin/tini", "--"]
# Default to the label pipeline. Override with `npm run regulatory:worker -- --schedule`.
CMD ["npm", "run", "worker"]
