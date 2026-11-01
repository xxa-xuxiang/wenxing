#!/usr/bin/env bash
# ============================================================
# 问星 —— 发布脚本（每次更新执行）
#
# 前置：已执行过 bootstrap.sh；backend-cloud/server/.env 已就位
#
# 用法：
#   sudo bash backend-cloud/deploy/deploy.sh              # 默认：后端 + 管理后台
#   sudo TARGETS=all bash backend-cloud/deploy/deploy.sh  # 额外构建桌面 Web/移动 H5
#   sudo SKIP_BUILD=1 bash ...                            # 只重启后端
# ============================================================
set -euo pipefail

REPO="${REPO:-/opt/wenxing}"
# 管理后台走同源 /api，不需要填地址；桌面/移动端打包时才需要
API_BASE="${API_BASE:-}"
WEB_ROOT="${WEB_ROOT:-/var/www/wenxing}"
SERVER_IP="${SERVER_IP:-YOUR_SERVER_IP}"
# admin | app | h5 | all
TARGETS="${TARGETS:-admin}"
SKIP_BUILD="${SKIP_BUILD:-0}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo"
fi

cd "$REPO"
[ -f backend-cloud/server/.env ] || {
  echo "✗ 缺少 backend-cloud/server/.env"
  echo "  先执行：cp backend-cloud/server/.env.production backend-cloud/server/.env"
  exit 1
}
# 服务以 wenxing 运行，需要可读；仅 root 可写
$SUDO chown root:wenxing backend-cloud/server/.env
$SUDO chmod 640 backend-cloud/server/.env

# ---------- 1. 后端依赖 ----------
echo "==> 安装后端依赖"
( cd backend-cloud/server && npm ci --no-audit --no-fund && npx prisma generate )

# ---------- 2. 停服务（SQLite 单文件，运行中迁移会 database is locked）----------
if $SUDO systemctl is-active --quiet wenxing-api; then
  echo "==> 停止后端，避免迁移时数据库被锁"
  $SUDO systemctl stop wenxing-api
fi

# ---------- 3. 备份（迁移前）----------
if [ -f backend-cloud/data/wenxing.db ]; then
  echo "==> 备份数据库"
  ( cd backend-cloud/server && npm run db:backup )
else
  echo "==> 未发现既有数据库，跳过备份（首次部署）"
fi

# ---------- 3. 迁移 ----------
echo "==> 执行数据库迁移（migrate deploy）"
( cd backend-cloud/server && npx prisma migrate deploy )

# 迁移以 root 执行，生成的库文件属主会变成 root；服务以 wenxing 运行，必须归还
$SUDO chown -R wenxing:wenxing backend-cloud/data
$SUDO chmod 750 backend-cloud/data

# ---------- 4. 构建 ----------
build_target() {
  case "$1" in
    admin)
      echo "==> 构建管理后台"
      ( cd admin-web && npm ci --no-audit --no-fund && npm run build )
      ;;
    app)
      echo "==> 构建桌面端 Web 版"
      ( cd frontend-desktop && npm ci --no-audit --no-fund && VITE_API_BASE="$API_BASE" npm run build )
      ;;
    h5)
      echo "==> 构建移动端 H5"
      ( cd frontent-phone && npm ci --no-audit --no-fund && VITE_API_BASE="$API_BASE" npm run build )
      ;;
  esac
}

# ---------- 5. 发布静态资源 ----------
publish_target() {
  case "$1" in
    admin)
      $SUDO install -d -m 755 "$WEB_ROOT/admin"
      $SUDO rsync -a --delete admin-web/dist/ "$WEB_ROOT/admin/"
      ;;
    app)
      $SUDO install -d -m 755 "$WEB_ROOT/app"
      $SUDO rsync -a --delete frontend-desktop/dist/ "$WEB_ROOT/app/"
      ;;
    h5)
      $SUDO install -d -m 755 "$WEB_ROOT/h5"
      $SUDO rsync -a --delete frontent-phone/dist/ "$WEB_ROOT/h5/"
      ;;
  esac
}

if [ "$SKIP_BUILD" != "1" ]; then
  if [ "$TARGETS" = "all" ]; then
    for t in app h5 admin; do
      build_target "$t"
      publish_target "$t"
    done
  else
    for t in $TARGETS; do
      build_target "$t"
      publish_target "$t"
    done
  fi
fi

# ---------- 6. 重启服务 ----------
echo "==> 重启后端"
$SUDO systemctl restart wenxing-api

echo "==> 校验并重启 Nginx"
$SUDO nginx -t
# 用 restart 而不是 reload：nginx 未运行/处于 failed 状态时 reload 也会报
# "Job for nginx.service failed"，restart 会把真实错误暴露出来
if ! $SUDO systemctl restart nginx; then
  echo "✗ Nginx 启动失败，最近 40 行日志："
  $SUDO journalctl -xeu nginx --no-pager -n 40 || true
  echo "  排查端口占用：ss -ltnp | grep -E ':(80|443|3001)'"
  exit 1
fi
if [ "$($SUDO systemctl is-active nginx)" != "active" ]; then
  echo "✗ Nginx 未处于 active 状态"
  $SUDO journalctl -xeu nginx --no-pager -n 40 || true
  exit 1
fi

# ---------- 7. 健康检查 ----------
echo "==> 健康检查"
ok=0
for _ in $(seq 1 15); do
  if curl -fsS "http://127.0.0.1:3001/api/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "✗ 后端未就绪，查看日志：journalctl -u wenxing-api -n 100 --no-pager"
  exit 1
fi
echo "✓ $(curl -fsS http://127.0.0.1:3001/api/health)"

cat <<EOF

✓ 发布完成
  管理后台 : http://$SERVER_IP/admin/
  健康检查 : curl http://127.0.0.1:3001/api/health（不对外开放）
  服务日志 : journalctl -u wenxing-api -f
EOF
