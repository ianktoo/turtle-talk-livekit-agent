#!/usr/bin/env bash
set -euo pipefail

SERVICE="turtle-talk-agent"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Stopping $SERVICE..."
systemctl --user stop "$SERVICE"

echo "==> Pulling latest changes..."
cd "$REPO_DIR"
git pull

echo "==> Starting $SERVICE..."
systemctl --user start "$SERVICE"

echo "==> Status:"
systemctl --user status "$SERVICE" --no-pager
