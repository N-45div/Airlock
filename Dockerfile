# Airlock: one image with the server, the web app, Claude Code (through the
# Agent SDK), ArmorIQ's ArmorClaude plugin and sgrep.

# sgrep publishes only a macOS binary, so build it.
FROM rust:1-bookworm AS sgrep
ARG SGREP_REF=main
RUN cargo install --git https://github.com/context-dot-dev/sgrep --branch ${SGREP_REF} --locked --root /out

FROM node:24-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
COPY web/package.json web/
RUN npm ci --include-workspace-root --workspace @airlock/web
COPY server/types.ts server/
COPY web web
RUN npm run build

FROM node:24-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep tini \
 && rm -rf /var/lib/apt/lists/*

# ArmorClaude, pinned to the commit Airlock was tested with.
ARG ARMORCLAUDE_COMMIT=3195800
RUN git clone --quiet https://github.com/armoriq/armorClaude.git /opt/armorclaude \
 && git -C /opt/armorclaude checkout --quiet ${ARMORCLAUDE_COMMIT} \
 && cd /opt/armorclaude \
 && npm install --omit=dev --ignore-scripts --no-audit --no-fund --silent \
 && node -e "require('fs').writeFileSync('node_modules/.armorclaude-installed', require('./package.json').version)" \
 && rm -rf .git

COPY --from=sgrep /out/bin/sgrep /usr/local/bin/sgrep

RUN useradd --create-home --uid 10001 airlock
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false --no-audit --no-fund \
 && npm cache clean --force
COPY server server
COPY samples samples
COPY --from=web /app/web/dist web/dist

USER airlock
ENV HOME=/home/airlock \
    NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    AIRLOCK_DATA=/data \
    ARMORCLAUDE_DIR=/opt/armorclaude \
    ARMORCLAUDE_DATA_DIR=/home/airlock/.armorclaude \
    SGREP_BIN=/usr/local/bin/sgrep \
    HF_HOME=/home/airlock/.cache/huggingface

# Fetch sgrep's model and the code parsers for common languages once, at build time.
RUN mkdir -p /tmp/warm && cd /tmp/warm \
 && echo 'function send(d) { return fetch(u, { body: d }) }' > a.js \
 && echo 'export function send(d: string) { return fetch(u, { body: d }) }' > b.ts \
 && printf 'def send(d):\n    return post(u, d)\n' > c.py \
 && printf 'package m\nfunc Send(d string) {}\n' > d.go \
 && echo 'fn send(d: &str) {}' > e.rs \
 && echo 'class S { void send(String d) {} }' > f.java \
 && echo 'void send(const char *d) {}' > g.c \
 && (HF_HUB_OFFLINE=0 sgrep "send data to a server" /tmp/warm > /dev/null || true) \
 && cd / && rm -rf /tmp/warm

USER root
RUN mkdir -p /data && chown airlock:airlock /data
USER airlock
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--no-warnings", "server/main.ts"]
