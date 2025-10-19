#!/usr/bin/env bash
. /etc/os-release
if [[ ID == alpine ]]; then
  export INSTALL_K3S_SKIP_DOWNLOAD=true
fi

export THIS_IP=$(curl icanhazip.com)
export INSTALL_K3S_EXEC="server --tls-san $THIS_IP --cluster-init --flannel-backend=wireguard-native --disable=traefik"
curl -sfL https://get.k3s.io | sh -s -
