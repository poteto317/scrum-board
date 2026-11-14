#!/bin/sh
# 静的配信の web を止め、ng serve（live-reload / 自動反映）の web-dev を起動する。
set -eu
cd "$(dirname "$0")/.."
docker compose stop web >/dev/null 2>&1 || true
docker compose --profile dev up -d db api web-dev
# Compose と同じ .env / 環境の割当を表示する（シェルの WEB_PORT だけに頼らない）
host_port="$(docker compose --profile dev port web-dev 4200 2>/dev/null | awk -F: '{print $NF}')"
echo "開発用画面: http://localhost:${host_port:-4200} （ソース保存で自動反映）"
echo "ログ: docker compose --profile dev logs -f web-dev"
echo "静的配信に戻す: docker compose --profile dev stop web-dev && docker compose up -d web"
