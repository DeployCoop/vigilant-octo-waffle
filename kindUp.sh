#!/usr/bin/env bash
source ./.env
source ./src/w8.bash
source ./src/check_cmd.bash
check_cmd kind
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  set -eu
  kind create cluster --config=./src/kind-config.yaml
}

check_docker
time main
