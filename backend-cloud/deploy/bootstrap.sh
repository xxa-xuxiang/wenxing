#!/usr/bin/env bash
# ============================================================
# 问星 —— 服务器初始化（只需执行一次）
# 适用：Ubuntu 22.04 / 24.04，root 执行
# 做的事：装 Node 22、Nginx、防火墙、系统用户、目录、
#         systemd 服务、Nginx 站点配置（默认占位地址，部署前用 SERVER_IP=你的地址 覆盖）
#
# 用法：
#   sudo bash backend-cloud/deploy/bootstrap.sh
#
# 注意：本脚本会用 deploy/nginx.conf 覆盖 /etc/nginx/nginx.conf，
#       适用于「整台服务器只跑问星」的场景；覆盖前会自动备份。
# ============================================================
set -euo pipefail

REPO="${REPO:-/opt/wenxing}"
WEB_ROOT="${WEB_ROOT:-/var/www/wenxing}"
SERVER_IP="${SERVER_IP:-YOUR_SERVER_IP}"
DEPLOY_DIR="$REPO/backend-cloud/deploy"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 执行：sudo bash $0"
  exit 1
fi

echo "==> 1/8 安装基础依赖"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg rsync ufw nginx

echo "==> 2/8 安装 Node.js 22（NodeSource）"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 20 ]; then
  install -d -m 755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    -o /etc/apt/keyrings/nodesource.asc
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_22.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
fi
echo "    node $(node -v) / npm $(npm -v)"

echo "==> 3/8 低内存机器补 2G swap（避免前端构建 OOM）"
mem_mb=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 3584 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    已启用 2G swap（当前内存 ${mem_mb}MB）"
else
  echo "    跳过（内存 ${mem_mb}MB）"
fi

echo "==> 4/8 创建系统用户与目录"
if ! id -u wenxing >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin wenxing
fi
install -d -o root -g root -m 755 "$REPO"
install -d -o wenxing -g wenxing -m 750 "$REPO/backend-cloud/data"
install -d -o root -g root -m 755 "$WEB_ROOT" "$WEB_ROOT/admin"

echo "==> 5/8 配置防火墙（只放行 SSH / HTTP / HTTPS）"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "==> 6/8 安装 systemd 服务"
if [ ! -f "$DEPLOY_DIR/wenxing-api.service" ]; then
  echo "    找不到 $DEPLOY_DIR/wenxing-api.service，请先把代码同步到 $REPO"
  exit 1
fi
install -m 644 "$DEPLOY_DIR/wenxing-api.service" /etc/systemd/system/wenxing-api.service
systemctl daemon-reload
systemctl enable wenxing-api

echo "==> 7/8 安装 Nginx 配置（整机接管 80 端口）"
# 80 端口被别的服务占用时，nginx 必然起不来，先把现场打出来
if ss -ltnp 2>/dev/null | grep -q ':80 '; then
  echo "    警告：80 端口已有进程占用（旧官网），请停掉它："
  ss -ltnp | grep ':80 ' || true
  echo "    Apache: systemctl disable --now apache2"
  echo "    宝塔 Nginx: /etc/init.d/nginx stop"
fi
if [ -f /etc/nginx/nginx.conf ] && [ ! -f /etc/nginx/nginx.conf.wenxing-bak ]; then
  cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.wenxing-bak
fi
install -m 644 "$DEPLOY_DIR/nginx.conf" /etc/nginx/nginx.conf
nginx -t
systemctl enable nginx
if ! systemctl restart nginx; then
  echo "✗ Nginx 启动失败，最近 40 行日志："
  journalctl -xeu nginx --no-pager -n 40 || true
  echo "  排查端口占用：ss -ltnp | grep -E ':(80|443|3001)'"
  exit 1
fi
systemctl is-active nginx

echo "==> 8/8 时区"
timedatectl set-timezone Asia/Shanghai || true

cat <<EOF

✓ 初始化完成
  服务器       : $SERVER_IP
  代码目录     : $REPO
  数据目录     : $REPO/backend-cloud/data（属主 wenxing）
  站点目录     : $WEB_ROOT/admin
  服务状态     : systemctl status wenxing-api（首次发布后才会启动）

下一步：
  1) 上传代码与 .env（见部署说明）
  2) sudo bash $REPO/backend-cloud/deploy/deploy.sh
  3) 访问 http://$SERVER_IP/admin/
EOF
