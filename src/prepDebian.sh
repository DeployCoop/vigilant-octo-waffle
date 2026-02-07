#!/usr/bin/env bash
sudo apt-get install -y libnss3-tools mkcert zsh rsync git curl btop htop vim net-tools dnsutils sudo jq kubecolor kubectl kubectx kubetail parallel pwgen sshuttle python3-bcrypt unattended-upgrades
echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | sudo debconf-set-selections
sudo dpkg-reconfigure -f noninteractive unattended-upgrades
src/installHelm.sh
src/installArgoCLI.sh
src/install-yq-go.sh
src/install_istioctl.sh
src/install_k3ai.sh
