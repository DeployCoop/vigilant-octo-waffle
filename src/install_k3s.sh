#!/bin/sh
THIS_IP=$(curl icanhazip.com)
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --tls-san $THIS_IP" sh -s - \
	--flannel-backend=wireguard-native
