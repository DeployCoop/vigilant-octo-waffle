#!/usr/bin/env bash
set -eux
sudo pacman -S argocd kustomize helm mkcert zsh rsync git curl \
  btop htop net-tools dnsutils sudo jq kubectl kubectx \
  parallel pwgen sshuttle python-bcrypt
src/install-yq-go.sh
src/install_istioctl.sh
