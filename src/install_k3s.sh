#!/usr/bin/env bash
set -euo pipefail

mkdir -p ./.secrets

# Safe IP resolution with multiple fallbacks
if [[ -z "${THIS_IP:-}" ]]; then
  THIS_IP=$(curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
fi

: "${FLANNEL_BACKEND:=wireguard-native}"
: "${INSTALL_K3S_EXEC_COMMON:=server --tls-san $THIS_IP --flannel-backend=${FLANNEL_BACKEND} --embedded-registry --disable=traefik --secrets-encryption}"

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
echo "export K3S_URL='https://${THIS_IP}:6443'" >> ./.secrets/k3s_env
echo "export INSTALL_K3S_EXEC='${INSTALL_K3S_EXEC_COMMON}'" >> ./.secrets/k3s_env
chmod 600 ./.secrets/k3s_env

# 1. Legacy init node script
THIS_FILE=./.secrets/k3s_init_node.sh
echo '#!/usr/bin/env bash' > ${THIS_FILE}
echo "export THIS_IP=\$(curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || ip route get 1.1.1.1 2>/dev/null | awk '{print \$7}' || hostname -I 2>/dev/null | awk '{print \$1}' || echo '127.0.0.1')" >> ${THIS_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${THIS_FILE}
echo "export K3S_URL='https://${THIS_IP}:6443'" >> ${THIS_FILE}
echo "export INSTALL_K3S_EXEC='${INSTALL_K3S_EXEC_COMMON}'" >> ${THIS_FILE}
echo "curl -sfL https://get.k3s.io | sh -s -" >> ${THIS_FILE}
chmod 700 ${THIS_FILE}

# 2. Worker node join script (k3s agent)
AGENT_FILE=./.secrets/k3s_join_agent.sh
echo '#!/usr/bin/env bash' > ${AGENT_FILE}
echo '# K3s Worker Node Join Script' >> ${AGENT_FILE}
echo 'set -euo pipefail' >> ${AGENT_FILE}
echo "export K3S_URL='https://${THIS_IP}:6443'" >> ${AGENT_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${AGENT_FILE}
echo 'echo "==> Joining K3s cluster at ${K3S_URL} as worker node..."' >> ${AGENT_FILE}
echo 'curl -sfL https://get.k3s.io | sh -s - agent "$@"' >> ${AGENT_FILE}
chmod 700 ${AGENT_FILE}

# 3. Additional control plane join script (k3s server HA)
SERVER_FILE=./.secrets/k3s_join_server.sh
echo '#!/usr/bin/env bash' > ${SERVER_FILE}
echo '# K3s HA Control-Plane Node Join Script' >> ${SERVER_FILE}
echo 'set -euo pipefail' >> ${SERVER_FILE}
echo "export THIS_LOCAL_IP=\$(curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || ip route get 1.1.1.1 2>/dev/null | awk '{print \$7}' || hostname -I 2>/dev/null | awk '{print \$1}' || echo '127.0.0.1')" >> ${SERVER_FILE}
echo "export K3S_URL='https://${THIS_IP}:6443'" >> ${SERVER_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${SERVER_FILE}
echo "export INSTALL_K3S_EXEC=\"server --tls-san \${THIS_LOCAL_IP} --flannel-backend=${FLANNEL_BACKEND} --embedded-registry --disable=traefik --secrets-encryption\"" >> ${SERVER_FILE}
echo 'echo "==> Joining K3s cluster at ${K3S_URL} as additional control-plane server..."' >> ${SERVER_FILE}
echo 'curl -sfL https://get.k3s.io | sh -s - "$@"' >> ${SERVER_FILE}
chmod 700 ${SERVER_FILE}

echo "============================================================"
echo "K3s Primary Server Initialized Successfully!"
echo "Server Endpoint : https://${THIS_IP}:6443"
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
