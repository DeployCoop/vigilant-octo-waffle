#!/usr/bin/env bash
set -eu
set -a && source .env && set +a
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  kubectl apply -f ${THIS_SECRETS}.yaml
  ./src/dockerCreds.sh
  ./src/prepargo.sh
}

time main
