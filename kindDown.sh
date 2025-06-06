#!/usr/bin/env bash
source ./src/check_cmd.bash
check_cmd kind
source ./src/util.bash
main () {
  set -eux
  kind delete cluster --name=vigilant-octo-waffle
}
check_docker
time main
