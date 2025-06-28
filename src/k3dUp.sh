#!/usr/bin/env bash
source ./src/sourceror.bash
this_cwd=$(pwd)

main () {
  TMP=$(mktemp)
  trap 'rm $TMP' EXIT
  #envsubst < ${KIND_CONFIG_TPL} > ${TMP}
  set -eu
  k3d cluster create vigilant-octo-waffle \
  --port 80:80@loadbalancer \
  --port 443:443@loadbalancer \
  --port 8000:8000@loadbalancer \
  --k3s-arg "--disable=traefik@server:0"
  kubectl cluster-info --context k3d-vigilant-octo-waffle
}

check_docker
time main
