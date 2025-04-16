#!/usr/bin/env bash
source ./.env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

check_docker () {
docker ps
if [[ ! $? -eq 0 ]]; then
  sudo systemctl restart docker
fi
}

main () {
  set -eu
  kind create cluster --config=./src/kind-config.yaml
}

check_docker
time main
