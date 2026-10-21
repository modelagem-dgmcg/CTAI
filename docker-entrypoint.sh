#!/bin/sh
# Disco persistente (ex.: Render) é montado como root. Acerta a posse da pasta de dados e roda o sistema sem privilégios.
set -e
DADOS="${CTAI_DATA_DIR:-/dados}"
mkdir -p "$DADOS"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DADOS" 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
