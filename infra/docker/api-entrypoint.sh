#!/bin/sh
# Entrypoint of the lift-api image. `migrate` applies the packages/db migrations with drizzle-kit
# and exits: the deploy runs it as a one-off container (`lift-release.sh migrate`) before the
# rollout. Anything else runs as given, so the default command starts the API.
set -eu

if [ "${1:-}" = migrate ]; then
  cd /app/db
  if [ ! -f migrations/meta/_journal.json ]; then
    echo "migrate: packages/db has no migrations yet; nothing to apply"
    exit 0
  fi
  exec node_modules/.bin/drizzle-kit migrate --config drizzle.config.ts
fi

exec "$@"
