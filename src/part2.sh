#!/usr/bin/env bash
set -eu
set -a && source .env && set +a
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu
  kubectl apply -f ${THIS_SECRETS}.yaml
  ./src/dockerCreds.sh
  initializer "$this_cwd/init/postgres"
  ./src/continue.sh
}

time main
