#!/usr/bin/env bash
. /etc/os-release
if [[ ID == alpine ]]; then
  export INSTALL_K3S_SKIP_DOWNLOAD=true
fi

export THIS_IP=$(curl icanhazip.com)
export INSTALL_K3S_EXEC="server --tls-san $THIS_IP --cluster-init --flannel-backend=wireguard-native --disable=traefik --secrets-encryption"
curl -sfL https://get.k3s.io | sh -s -

SECRET=$(cat /var/lib/rancher/k3s/server/node-token)
THIS_FILE=.secrets/k3s_init_node.sh
SERVER_IP=$(curl icanhazip.com)

echo '#!/bin/bash' > ${THIS_FILE}
echo 'export THIS_IP=$(curl icanhazip.com)' >> ${THIS_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${THIS_FILE}
echo "export K3S_URL='https://${SERVER_IP}:6443'" >> ${THIS_FILE}
echo 'export INSTALL_K3S_EXEC="server --tls-san $THIS_IP --flannel-backend=wireguard-native --disable=traefik --secrets-encryption"' >> ${THIS_FILE}
echo "curl -sfL https://get.k3s.io | sh -s -" >> ${THIS_FILE}
