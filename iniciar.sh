#!/usr/bin/env sh
# Sobe o sistema CTAI. Uso: ./iniciar.sh
set -e
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -f .env ] || cp .env.example .env
exec npm start
