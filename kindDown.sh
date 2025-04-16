#!/usr/bin/env bash
source ./src/initializer.bash
main () {
  set -eux
  kind delete cluster --name=vigilant-octo-waffle
}
check_docker
time main
