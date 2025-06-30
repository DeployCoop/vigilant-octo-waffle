#!/usr/bin/env bash
source ./src/sourceror.bash
this_cwd=$(pwd)

main_no_config () {
  set -eu
  k3d cluster create vigilant-octo-waffle \
  --servers 3 \
  --registry-create this-cluster-registry \
  --port 80:80@loadbalancer \
  --port 443:443@loadbalancer \
  --port 8000:8000@loadbalancer \
  --k3s-arg "--disable=traefik@server:0"
  kubectl cluster-info --context k3d-vigilant-octo-waffle
}
main () {
  mkdir -p ${THIS_STORAGE_PATH}/workerk3d
  TMP=$(mktemp)
  trap 'rm $TMP' EXIT
  envsubst < ${K3D_CONFIG_TPL} > ${TMP}
  set -eu
  k3d cluster create -c ${TMP}
  kubectl cluster-info --context k3d-vigilant-octo-waffle
}

check_docker
time main
