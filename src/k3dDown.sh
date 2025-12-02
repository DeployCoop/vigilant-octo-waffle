#!/usr/bin/env bash
source ./src/sourceror.bash

main () {
  set -eu
  k3d cluster delete vigilant-octo-waffle
  sleep 2
}

check_docker
time main
