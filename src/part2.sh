#!/bin/bash
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu
  kubectl apply -f examplenc-secrets.yaml
  initializer $this_cwd/src/postgres_init
  ./src/continue.sh
}

time main
