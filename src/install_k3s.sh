#!/usr/bin/env bash
export THIS_IP=$(curl icanhazip.com)
export INSTALL_K3S_EXEC="server --tls-san $THIS_IP --cluster-init --flannel-backend=wireguard-native --disable=traefik"
curl -sfL https://get.k3s.io | sh -s -
