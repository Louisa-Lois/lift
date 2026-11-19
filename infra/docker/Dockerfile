# syntax=docker/dockerfile:1
# The six Lift platform images (INF-07). Build from the repo root:
#   docker build -f infra/docker/Dockerfile --target <target> --build-arg APP=<app> .
#
#   target     APP                    image          runs
#   web        web                    lift-web       next start on 3000
#   api        api                    lift-api       node dist/index.js; `migrate` applies packages/db migrations
#   node-app   collab | agent | mcp   lift-<app>     node dist/index.js (mcp: compose picks the entry)
#   worker     worker                 lift-worker    node dist/index.js, as root (it holds the Docker socket)
#
# Everything image-specific lives here, so no app folder needs a Dockerfile of its own.
# infra/docker/Dockerfile.dockerignore keeps .env files, node_modules and build output out of the context.

ARG NODE_IMAGE=node:24-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV CI=1 NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
# pnpm at the exact version package.json pins in packageManager.
COPY package.json ./
RUN npm install --global --no-fund --no-audit "$(node -p 'require("./package.json").packageManager')"

FROM base AS build
ARG APP
RUN test -n "${APP}" || { echo "pass --build-arg APP=<app>" >&2; exit 1; }
# Next.js inlines NEXT_PUBLIC_* into the browser bundle at build time; only web uses it. Never a secret.
ARG NEXT_PUBLIC_COLLAB_URL=""
ENV NEXT_PUBLIC_COLLAB_URL=${NEXT_PUBLIC_COLLAB_URL}
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@lift/${APP}..."
RUN pnpm --filter "@lift/${APP}" build
# /out: the app with production dependencies only, plus its build output.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm --filter "@lift/${APP}" deploy --prod --legacy /out \
 && rm -rf /out/dist /out/.next \
 && if [ -d "apps/${APP}/dist" ]; then cp -R "apps/${APP}/dist" /out/dist; fi \
 && if [ -d "apps/${APP}/.next" ]; then cp -R "apps/${APP}/.next" /out/.next && rm -rf /out/.next/cache; fi
# /out-db: packages/db with drizzle-kit, so the API image can run migrations. Empty for other apps.
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    mkdir -p /out-db \
 && if [ "${APP}" = api ]; then \
      pnpm install --frozen-lockfile --filter @lift/db \
      && pnpm --filter @lift/db deploy --legacy /out-db; \
    fi

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app

FROM runtime AS node-app
# Code stays owned by root, so the app (user node) cannot rewrite itself.
COPY --from=build /out ./
USER node
CMD ["node", "dist/index.js"]

FROM node-app AS api
COPY --from=build /out-db ./db
COPY infra/docker/api-entrypoint.sh /usr/local/bin/lift-api-entrypoint
ENTRYPOINT ["lift-api-entrypoint"]
CMD ["node", "dist/index.js"]

FROM runtime AS worker
# The build job's tools (INF-04): git clones, Railpack builds through BuildKit, and the Docker CLI
# is what Railpack runs (`docker load`) to hand the image to Docker; without it Railpack hangs.
# Both downloads are pinned and checked against their SHA-256 (Railpack's from its release's
# checksums.txt; Docker's computed from download.docker.com, which publishes none for 29.9.3).
ARG TARGETARCH
ARG RAILPACK_VERSION=0.43.0
ARG DOCKER_CLI_VERSION=29.9.3
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) railpack_arch=x86_64; docker_arch=x86_64; \
        railpack_sha=248a8f60f36854aabed6124113631078a802de3461660855fc4de9c26065c1fb; \
        docker_sha=3fb5d1f13014c18cc54945bc177c58a9056a482dada031e17d12cf2e6922c973 ;; \
      arm64) railpack_arch=arm64; docker_arch=aarch64; \
        railpack_sha=732ece14eb4f4676a43ebba19431f954edf7b130acb76159ef0f2ff86ac42ac9; \
        docker_sha=1b27fd739378ef938401e81ce5afb73b7ad7432d4f598814a9ff5f826bb464d2 ;; \
      *) echo "unsupported TARGETARCH '${TARGETARCH}'" >&2; exit 1 ;; \
    esac; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl git; \
    curl -fsSL -o /tmp/railpack.tgz \
      "https://github.com/railwayapp/railpack/releases/download/v${RAILPACK_VERSION}/railpack-v${RAILPACK_VERSION}-${railpack_arch}-unknown-linux-musl.tar.gz"; \
    echo "${railpack_sha}  /tmp/railpack.tgz" | sha256sum -c -; \
    tar -xzf /tmp/railpack.tgz -C /usr/local/bin railpack; \
    curl -fsSL -o /tmp/docker.tgz \
      "https://download.docker.com/linux/static/stable/${docker_arch}/docker-${DOCKER_CLI_VERSION}.tgz"; \
    echo "${docker_sha}  /tmp/docker.tgz" | sha256sum -c -; \
    tar -xzf /tmp/docker.tgz -C /usr/local/bin --strip-components=1 docker/docker; \
    rm /tmp/railpack.tgz /tmp/docker.tgz; \
    apt-get purge -y curl; \
    apt-get autoremove -y; \
    rm -rf /var/lib/apt/lists/*; \
    git --version; railpack --version; docker --version
COPY --from=build /out ./
CMD ["node", "dist/index.js"]

FROM runtime AS web
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--port", "3000", "--hostname", "0.0.0.0"]
