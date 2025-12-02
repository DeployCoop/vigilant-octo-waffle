#!/usr/bin/env bash
THIS_THING=kubeshark
source ./src/common.sh

main () {
  set -eu
  argoRunner "${THIS_THING}"
  #initializer "${this_cwd}/init/${THIS_THING}"
  w8_all_namespace "${THIS_NAMESPACE}" 
}
time main
