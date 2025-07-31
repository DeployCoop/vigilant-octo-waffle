#!/usr/bin/env bash
source ./src/sourceror.bash
this_cwd=$(pwd)

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
