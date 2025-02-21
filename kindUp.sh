#!/bin/bash
source ./.env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  set -eu
  kind create cluster --config=./src/kind-config.yaml
}

time main
