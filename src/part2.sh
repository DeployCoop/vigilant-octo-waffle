#!/usr/bin/env bash
set -eu
source .env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu
  kubectl apply -f ${THIS_SECRETS}.yaml
  initializer "$this_cwd/init/postgres"
  ./src/continue.sh
}

time main
