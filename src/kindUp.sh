#!/usr/bin/env bash
source ./src/sourceror.bash
this_cwd=$(pwd)

main () {
  TMP=$(mktemp)
  trap 'rm $TMP' EXIT
  envsubst < ${KIND_CONFIG_TPL} > ${TMP}
  set -eu
  kind create cluster --config=${TMP}
}

check_docker
time main
