#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "用法: sudo bash rollback-release.sh <版本号>"
  exit 64
fi

version="$1"
app_root="/var/www/jingtu"
release_dir="$app_root/releases/$version"

if [[ ! -f "$release_dir/index.html" ]]; then
  echo "找不到可回滚版本: $release_dir"
  exit 66
fi

ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$app_root/current"
nginx -t
systemctl reload nginx

echo "已回滚到: $version"
