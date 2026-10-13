#!/usr/bin/env bash
set -euo pipefail

mkdir -p ./.secrets

# Safe IP resolution with multiple fallbacks
# 1. Prefer existing server_url if configured
if [[ -z "${THIS_IP:-}" && -f ./server_url && -s ./server_url ]]; then
  SERVER_URL_RAW=$(tr -d '[:space:]' < ./server_url)
  SERVER_HOST=$(echo "${SERVER_URL_RAW}" | sed -E 's|^https?://||; s|:[0-9]+$||; s|/.*$||')
  if [[ -n "${SERVER_HOST}" ]]; then
    THIS_IP="${SERVER_HOST}"
  fi
fi

# 2. Local routable IP fallback, then WAN IP
if [[ -z "${THIS_IP:-}" ]]; then
  THIS_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -I 2>/dev/null | awk '{print $1}' || curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || echo "127.0.0.1")
fi

# 3. Detect WAN IP for optional extra TLS SAN
EXTRA_SAN=""
WAN_IP=$(curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || true)
if [[ -n "${WAN_IP}" && "${WAN_IP}" != "${THIS_IP}" ]]; then
  EXTRA_SAN="--tls-san ${WAN_IP}"
fi

if [[ -f ./server_url && -s ./server_url ]]; then
  SAVED_URL=$(tr -d '[:space:]' < ./server_url)
  if [[ ! "${SAVED_URL}" =~ ^https?:// ]]; then
    SAVED_URL="https://${SAVED_URL}"
  fi
  if [[ ! "${SAVED_URL}" =~ :[0-9]+$ ]]; then
    SAVED_URL="${SAVED_URL}:6443"
  fi
  FINAL_SERVER_URL="${SAVED_URL}"
else
  FINAL_SERVER_URL="https://${THIS_IP}:6443"
fi
echo "${FINAL_SERVER_URL}" > ./server_url

: "${FLANNEL_BACKEND:=wireguard-native}"
: "${THIS_K3S_HA_VIP:=}"
if [[ -n "${THIS_K3S_HA_VIP}" ]]; then
  EXTRA_SAN="${EXTRA_SAN} --tls-san ${THIS_K3S_HA_VIP}"
fi

: "${ETCD_SNAPSHOT_CRON:=0 */4 * * *}"
: "${ETCD_SNAPSHOT_RETENTION:=14}"
ETCD_FLAGS="--etcd-snapshot-schedule-cron=${ETCD_SNAPSHOT_CRON} --etcd-snapshot-retention=${ETCD_SNAPSHOT_RETENTION}"

: "${INSTALL_K3S_EXEC_COMMON:=server --tls-san $THIS_IP ${EXTRA_SAN} --flannel-backend=${FLANNEL_BACKEND} --embedded-registry --disable=traefik --secrets-encryption ${ETCD_FLAGS}}"

# test alpine
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" == "alpine" ]]; then
    export INSTALL_K3S_SKIP_DOWNLOAD=true
  fi
fi

# run the cluster init
export INSTALL_K3S_EXEC="${INSTALL_K3S_EXEC_COMMON} --cluster-init"
curl -sfL https://get.k3s.io | sh -s -

# grab the token
SECRET=""
if [[ -f /var/lib/rancher/k3s/server/node-token ]]; then
  SECRET=$(cat /var/lib/rancher/k3s/server/node-token)
fi

echo "${SECRET}" > ./.secrets/k3s_token
chmod 600 ./.secrets/k3s_token

echo "export K3S_TOKEN='${SECRET}'" > ./.secrets/k3s_env
echo "export K3S_URL='${FINAL_SERVER_URL}'" >> ./.secrets/k3s_env
echo "export INSTALL_K3S_EXEC='${INSTALL_K3S_EXEC_COMMON}'" >> ./.secrets/k3s_env
chmod 600 ./.secrets/k3s_env

# 1. Legacy init node script
THIS_FILE=./.secrets/k3s_init_node.sh
echo '#!/usr/bin/env bash' > ${THIS_FILE}
echo "export THIS_IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{print \$7}' || hostname -I 2>/dev/null | awk '{print \$1}' || curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || echo '127.0.0.1')" >> ${THIS_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${THIS_FILE}
echo "export K3S_URL='${FINAL_SERVER_URL}'" >> ${THIS_FILE}
echo "export INSTALL_K3S_EXEC='${INSTALL_K3S_EXEC_COMMON}'" >> ${THIS_FILE}
echo "curl -sfL https://get.k3s.io | sh -s -" >> ${THIS_FILE}
chmod 700 ${THIS_FILE}

# 2. Worker node join script (k3s agent)
AGENT_FILE=./.secrets/k3s_join_agent.sh
echo '#!/usr/bin/env bash' > ${AGENT_FILE}
echo '# K3s Worker Node Join Script' >> ${AGENT_FILE}
echo 'set -euo pipefail' >> ${AGENT_FILE}
echo "export K3S_URL='${FINAL_SERVER_URL}'" >> ${AGENT_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${AGENT_FILE}
echo 'echo "==> Joining K3s cluster at ${K3S_URL} as worker node..."' >> ${AGENT_FILE}
echo 'curl -sfL https://get.k3s.io | sh -s - agent "$@"' >> ${AGENT_FILE}
chmod 700 ${AGENT_FILE}

# 3. Additional control plane join script (k3s server HA)
SERVER_FILE=./.secrets/k3s_join_server.sh
echo '#!/usr/bin/env bash' > ${SERVER_FILE}
echo '# K3s HA Control-Plane Node Join Script' >> ${SERVER_FILE}
echo 'set -euo pipefail' >> ${SERVER_FILE}
echo "export THIS_LOCAL_IP=\$(ip route get 1.1.1.1 2>/dev/null | awk '{print \$7}' || hostname -I 2>/dev/null | awk '{print \$1}' || curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || echo '127.0.0.1')" >> ${SERVER_FILE}
echo "export K3S_URL='${FINAL_SERVER_URL}'" >> ${SERVER_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${SERVER_FILE}
echo "export INSTALL_K3S_EXEC=\"server --tls-san \${THIS_LOCAL_IP} --flannel-backend=${FLANNEL_BACKEND} --embedded-registry --disable=traefik --secrets-encryption\"" >> ${SERVER_FILE}
echo 'echo "==> Joining K3s cluster at ${K3S_URL} as additional control-plane server..."' >> ${SERVER_FILE}
echo 'curl -sfL https://get.k3s.io | sh -s - "$@"' >> ${SERVER_FILE}
chmod 700 ${SERVER_FILE}

echo "============================================================"
echo "K3s Primary Server Initialized Successfully!"
echo "Server Endpoint : ${FINAL_SERVER_URL}"
echo "Join Token Saved: ./.secrets/k3s_token"
echo ""
echo "To join worker nodes, run:"
echo "  ./src/k3s_add_node.sh --role agent"
echo "  or copy and execute ./.secrets/k3s_join_agent.sh on worker nodes"
echo ""
echo "To join additional control-plane (HA server) nodes, run:"
echo "  ./src/k3s_add_node.sh --role server"
echo "  or copy and execute ./.secrets/k3s_join_server.sh on server nodes"
echo "============================================================"
