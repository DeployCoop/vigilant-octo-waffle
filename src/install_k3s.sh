#!/usr/bin/env bash
THIS_FILE=./.secrets/k3s_init_node.sh
THIS_IP=$(curl icanhazip.com)
: "${FLANNEL_BACKEND=wireguard-native}"
: "${INSTALL_K3S_EXEC_COMMON=server --tls-san $THIS_IP --flannel-backend=wireguard-native --disable=traefik --secrets-encryption}"

# test alpine
. /etc/os-release
if [[ ID == alpine ]]; then
  export INSTALL_K3S_SKIP_DOWNLOAD=true
fi

# run the cluster init
export INSTALL_K3S_EXEC="${INSTALL_K3S_EXEC_COMMON} --cluster-init"
curl -sfL https://get.k3s.io | sh -s -

# grab the token 
SECRET=$(cat /var/lib/rancher/k3s/server/node-token)

echo "export K3S_TOKEN='${SECRET}'" >> ./.secrets/k3s_token
# make the k3s init node script
echo '#!/bin/bash' > ${THIS_FILE}
echo 'export THIS_IP=$(curl icanhazip.com)' >> ${THIS_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${THIS_FILE}
echo "export K3S_URL='https://${THIS_IP}:6443'" >> ${THIS_FILE}
echo "export INSTALL_K3S_EXEC='${INSTALL_K3S_EXEC_COMMON}'" >> ${THIS_FILE}
echo "curl -sfL https://get.k3s.io | sh -s -" >> ${THIS_FILE}
