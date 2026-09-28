#!/usr/bin/env bash
THIS_CWD=$(pwd)
set -xeu

mkdir -p /etc/rancher/k3s
cp -v ./registries.yaml /etc/rancher/k3s/registries.yaml

echo 'bringing up the main host'
cd "${THIS_CWD}/vigilant-octo-waffle/" 
./src/install_k3s.sh
cd ${THIS_CWD}

cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
