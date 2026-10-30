#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "用法: sudo bash deploy-release.sh <发布包.tar.gz> <版本号>"
  echo "示例: sudo bash deploy-release.sh /tmp/jingtu-hr-v0.1.0.tar.gz v0.1.0"
  exit 64
fi

archive="$(realpath "$1")"
version="$2"
app_root="/var/www/jingtu"
release_dir="$app_root/releases/$version"

if [[ ! "$version" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "版本号必须符合 v0.1.0 格式。"
  exit 64
fi

if [[ ! -f "$archive" ]]; then
  echo "找不到发布包: $archive"
  exit 66
fi

if [[ -e "$release_dir" ]]; then
  echo "版本已经存在，不会覆盖: $release_dir"
  exit 73
fi

install -d -m 755 "$release_dir"
tar -xzf "$archive" -C "$release_dir"

if [[ ! -f "$release_dir/index.html" || ! -f "$release_dir/app.js" ]]; then
  echo "发布包缺少 index.html 或 app.js。"
  exit 65
fi

chown -R www-data:www-data "$release_dir"
find "$release_dir" -type d -exec chmod 755 {} +
find "$release_dir" -type f -exec chmod 644 {} +

ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$app_root/current"

nginx -t
systemctl reload nginx

echo "部署完成: $version"
echo "当前版本: $(readlink -f "$app_root/current")"
