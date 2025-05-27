#!/usr/bin/env bash
source ./src/check_cmd.bash
check_cmd kind
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  set -eu
  kind create cluster --config=./src/kind-config.yaml
}

check_docker
time main
