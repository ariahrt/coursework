#!/usr/bin/env bash
# Runs on the server (deploy.ps1 uploads it). Installs or updates cnv.byhrt.com.
# Safe to re-run. Certbot only fetches the certificate (certonly); it never edits
# nginx configs, because *.byhrt.com in dash.byhrt.com makes it pick the wrong block.
set -euo pipefail

DOMAIN=cnv.byhrt.com
SRC="$HOME/cnv-deploy"
WEB="/var/www/$DOMAIN"
MARK="managed-by: cnv deploy"

command -v nginx >/dev/null || { echo "nginx isn't installed here, stopping."; exit 1; }

echo "==> Copying site files to $WEB"
sudo mkdir -p "$WEB"
sudo find "$WEB" -mindepth 1 -delete
sudo cp -r "$SRC/site/." "$WEB/"
sudo chmod -R a+rX "$WEB"

if [ -d /etc/nginx/sites-available ]; then
  CONF="/etc/nginx/sites-available/$DOMAIN"; LINK="/etc/nginx/sites-enabled/$DOMAIN"
else
  CONF="/etc/nginx/conf.d/$DOMAIN.conf"; LINK=""
fi

if [ -f "$CONF" ] && ! sudo grep -q "$MARK" "$CONF"; then
  echo "!! $CONF exists but wasn't made by this script. Not touching nginx."
  exit 0
fi
OTHER=$(sudo grep -rlsE "server_name[^;]*[[:space:]]$DOMAIN([[:space:];]|$)" /etc/nginx | grep -v -x -e "$CONF" -e "${LINK:-/nonexistent}" || true)
if [ -n "$OTHER" ]; then
  echo "!! Another nginx config already names $DOMAIN:"; echo "$OTHER"
  echo "!! Not touching nginx. Remove or merge that by hand, then re-run."
  exit 0
fi

# Writes $1 to the config, tests it, and puts the previous version back if the test fails.
install_conf() {
  local backup; backup=$(mktemp)
  [ -f "$CONF" ] && sudo cp "$CONF" "$backup"
  sudo cp "$1" "$CONF"
  [ -n "$LINK" ] && sudo ln -sf "$CONF" "$LINK"
  if ! sudo nginx -t; then
    echo "!! nginx config test failed, putting the previous config back."
    if [ -s "$backup" ]; then sudo cp "$backup" "$CONF"; else sudo rm -f "$CONF"; [ -n "$LINK" ] && sudo rm -f "$LINK"; fi
    exit 1
  fi
  sudo systemctl reload nginx
}

if ! sudo test -d "/etc/letsencrypt/live/$DOMAIN"; then
  command -v certbot >/dev/null || { echo "!! certbot isn't installed: sudo apt install certbot python3-certbot-nginx"; exit 1; }
  echo "==> No certificate yet: serving plain http for a moment so certbot can verify the domain"
  BOOT=$(mktemp)
  printf '# %s\nserver {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    root %s;\n}\n' "$MARK" "$DOMAIN" "$WEB" > "$BOOT"
  install_conf "$BOOT"
  sudo certbot certonly --nginx -d "$DOMAIN"
fi

echo "==> Installing nginx config at $CONF"
sudo mkdir -p /etc/nginx/snippets
sudo cp "$SRC/server/cnv-canvas-proxy.conf" /etc/nginx/snippets/cnv-canvas-proxy.conf
install_conf "$SRC/server/$DOMAIN.conf"

rm -rf "$SRC"
echo "==> Done: https://$DOMAIN"
