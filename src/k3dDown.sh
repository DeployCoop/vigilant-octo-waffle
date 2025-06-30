#!/usr/bin/env bash
source ./src/sourceror.bash

main () {
  set -eu
  k3d cluster delete vigilant-octo-waffle
}

check_docker
time main
