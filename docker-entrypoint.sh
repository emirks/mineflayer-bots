#!/bin/sh
set -e

DATA_DIR=/data

# Ensure persistent volume directories exist
mkdir -p "$DATA_DIR/logs"
mkdir -p "$DATA_DIR/auth-cache"

# Symlink auth-cache and logs from /app to the persistent volume so that
# orchestrator's hardcoded "./auth-cache" path ends up on the volume.
# Re-link on every start in case the container was rebuilt.
ln -sfn "$DATA_DIR/auth-cache" /app/auth-cache
ln -sfn "$DATA_DIR/logs"       /app/logs

echo "[entrypoint] data dir: $DATA_DIR"
echo "[entrypoint] auth-cache -> $DATA_DIR/auth-cache"
echo "[entrypoint] logs       -> $DATA_DIR/logs"

exec "$@"
