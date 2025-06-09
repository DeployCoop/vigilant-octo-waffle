#!/usr/bin/env bash
set -eu
source ./src/sourceror.bash
this_cwd=$(pwd)

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  kubectl apply -f ${THIS_SECRETS}.yaml
  ./src/dockerCreds.sh
}

time main
