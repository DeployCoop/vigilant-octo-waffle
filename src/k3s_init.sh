#!/usr/bin/env bash
SECRET=$(cat /var/lib/rancher/k3s/server/token)
THIS_FILE=/root/k3s_init_node.sh
SERVER_IP=$(curl icanhazip.com)

echo '#!/bin/bash' > ${THIS_FILE}
echo 'export THIS_IP=$(curl icanhazip.com)' >> ${THIS_FILE}
echo "export K3S_TOKEN='${SECRET}'" >> ${THIS_FILE}
echo 'export INSTALL_K3S_EXEC="server --tls-san $THIS_IP --flannel-backend=wireguard-native"' >> ${THIS_FILE}
echo "curl -sfL https://get.k3s.io | sh -s - --server https://${SERVER_IP}:6443" >> ${THIS_FILE}
