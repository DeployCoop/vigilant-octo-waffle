#!/usr/bin/env bash
THIS_THING=fossbilling
source ./src/common.sh

main () {
  set -eu
  argoRunner "${THIS_THING}"
  initializer "${this_cwd}/init/${THIS_THING}"
}

time main
