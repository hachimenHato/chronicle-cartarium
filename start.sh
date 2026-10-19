#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x ./runtime/node ]; then
  exec ./runtime/node scripts/launch.mjs
fi
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 22.18 或更新版本：https://nodejs.org/' >&2
  exit 1
fi
exec node scripts/launch.mjs
