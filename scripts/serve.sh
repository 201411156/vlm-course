#!/usr/bin/env bash
# 로컬 미리보기. 저장소 루트를 그대로 서빙한다 (Cloudflare Pages와 동일한 구조).
#   ./scripts/serve.sh          → http://localhost:8000
#   ./scripts/serve.sh 8080     → 포트 지정
set -euo pipefail
PORT="${1:-8000}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
echo "→ http://localhost:${PORT}/   (Ctrl-C 로 종료)"
echo "  root: ${ROOT}"
exec python3 -m http.server "${PORT}" --bind 127.0.0.1 --directory "${ROOT}"
