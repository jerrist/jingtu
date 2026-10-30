#!/usr/bin/env bash
set -euo pipefail

repo_url="https://github.com/jerrist/jingtu.git"
repo_api="https://api.github.com/repos/jerrist/jingtu"
branch="main"
source_dir="/var/lib/jingtu/github-source"
state_file="/var/lib/jingtu/deployed-commit"
staging_root="/var/lib/jingtu/staging"
backup_root="/var/lib/jingtu/backups"
app_root="/var/www/jingtu"
backend_file="/opt/jingtu/server/jingtu_api.py"
lock_file="/run/lock/jingtu-deploy.lock"

retry() {
  local attempt=1
  local max_attempts=3
  until "$@"; do
    if (( attempt >= max_attempts )); then
      echo "命令连续失败 $max_attempts 次: $*"
      return 1
    fi
    echo "命令失败，准备第 $((attempt + 1)) 次重试: $*"
    sleep $((attempt * 2))
    attempt=$((attempt + 1))
  done
}

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "已有部署任务正在运行，本次跳过。"
  exit 0
fi

install -d -m 750 -o jingtu -g jingtu /var/lib/jingtu "$staging_root" "$backup_root"
install -d -m 755 "$app_root/releases" /opt/jingtu/server

remote_sha="$(git ls-remote "$repo_url" "refs/heads/$branch" | awk '{print $1}')"
if [[ ! "$remote_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "无法读取 GitHub main 分支提交。"
  exit 1
fi

deployed_sha=""
if [[ -f "$state_file" ]]; then
  deployed_sha="$(tr -d '[:space:]' < "$state_file")"
fi
if [[ "$remote_sha" == "$deployed_sha" ]]; then
  echo "已经是最新提交: $remote_sha"
  exit 0
fi

ci_result="$(python3 - "$repo_api" "$remote_sha" <<'PY'
import json
import sys
import urllib.request

repo_api, sha = sys.argv[1:]
url = f"{repo_api}/actions/runs?head_sha={sha}&event=push&per_page=20"
request = urllib.request.Request(
    url,
    headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "jingtu-deploy/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    },
)
with urllib.request.urlopen(request, timeout=15) as response:
    payload = json.load(response)
runs = [
    run for run in payload.get("workflow_runs", [])
    if run.get("name") == "CI" and run.get("head_sha") == sha
]
if any(run.get("conclusion") == "success" for run in runs):
    print("success")
elif any(run.get("status") in {"queued", "in_progress", "requested", "waiting"} for run in runs):
    print("pending")
elif runs:
    print("failed")
else:
    print("missing")
PY
)"

if [[ "$ci_result" != "success" ]]; then
  echo "提交 $remote_sha 的 CI 状态为 $ci_result，暂不部署。"
  exit 0
fi

if [[ -d "$source_dir/.git" ]] && [[ "$(git -C "$source_dir" config --get remote.origin.promisor || true)" == "true" ]]; then
  echo "检测到旧的部分克隆，重建为完整浅克隆。"
  rm -rf -- "$source_dir"
fi
if [[ ! -d "$source_dir/.git" ]]; then
  rm -rf -- "$source_dir"
  retry git clone --depth 1 --branch "$branch" "$repo_url" "$source_dir"
fi
retry git -C "$source_dir" fetch --depth 1 origin "$remote_sha"
git -C "$source_dir" cat-file -e "$remote_sha^{commit}"

staging_dir="$(mktemp -d "$staging_root/$remote_sha.XXXXXX")"
release_tmp=""
backend_backup=""
previous_release=""
cleanup() {
  rm -rf -- "$staging_dir"
  if [[ -n "$release_tmp" && -d "$release_tmp" ]]; then
    rm -rf -- "$release_tmp"
  fi
}
trap cleanup EXIT

git -C "$source_dir" archive "$remote_sha" | tar -xf - -C "$staging_dir"

required=(
  "$staging_dir/dist/index.html"
  "$staging_dir/dist/app.js"
  "$staging_dir/dist/version.json"
  "$staging_dir/server/jingtu_api.py"
)
for path in "${required[@]}"; do
  if [[ ! -f "$path" ]]; then
    echo "提交缺少部署文件: $path"
    exit 1
  fi
done
if find "$staging_dir/dist" "$staging_dir/server/jingtu_api.py" -type l -print -quit | grep -q .; then
  echo "部署内容包含符号链接，已拒绝。"
  exit 1
fi

node --check "$staging_dir/dist/app.js"
node --check "$staging_dir/dist/service-worker.js"
python3 -m py_compile "$staging_dir/server/jingtu_api.py"

short_sha="${remote_sha:0:12}"
release_dir="$app_root/releases/git-$short_sha"
if [[ ! -d "$release_dir" ]]; then
  release_tmp="$app_root/releases/.git-$short_sha.tmp"
  rm -rf -- "$release_tmp"
  install -d -m 755 "$release_tmp"
  cp -a "$staging_dir/dist/." "$release_tmp/"
  chown -R www-data:www-data "$release_tmp"
  find "$release_tmp" -type d -exec chmod 755 {} +
  find "$release_tmp" -type f -exec chmod 644 {} +
  mv "$release_tmp" "$release_dir"
  release_tmp=""
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
db_backup="$backup_root/jingtu-$timestamp-$short_sha.db"
python3 - "$db_backup" <<'PY'
import os
import sqlite3
import sys

target = sys.argv[1]
source = sqlite3.connect("/var/lib/jingtu/jingtu.db")
backup = sqlite3.connect(target)
try:
    source.backup(backup)
finally:
    backup.close()
    source.close()
os.chmod(target, 0o640)
PY
chown jingtu:jingtu "$db_backup"

previous_release="$(readlink -f "$app_root/current" || true)"
backend_backup="$backup_root/jingtu_api-$timestamp-$short_sha.py"
if [[ -f "$backend_file" ]]; then
  cp -a "$backend_file" "$backend_backup"
fi

install -o root -g root -m 644 "$staging_dir/server/jingtu_api.py" "$backend_file"
ln -sfn "$release_dir" "$app_root/current.next"
mv -Tf "$app_root/current.next" "$app_root/current"

nginx -t
systemctl restart jingtu-api

healthy="false"
for _ in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/api/health >/dev/null; then
    healthy="true"
    break
  fi
  sleep 1
done

if [[ "$healthy" != "true" ]]; then
  echo "新版本健康检查失败，开始回滚。"
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    ln -sfn "$previous_release" "$app_root/current.next"
    mv -Tf "$app_root/current.next" "$app_root/current"
  fi
  if [[ -f "$backend_backup" ]]; then
    install -o root -g root -m 644 "$backend_backup" "$backend_file"
  fi
  systemctl restart jingtu-api
  exit 1
fi

printf '%s\n' "$remote_sha" > "$state_file"
chown jingtu:jingtu "$state_file"
chmod 640 "$state_file"

echo "部署成功: $remote_sha"
echo "前端版本: $release_dir"
echo "数据库备份: $db_backup"
