#!/usr/bin/env bash
THIS_THING=drupal
source ./src/common.sh

main () {
  set -eu
  argoRunner "${THIS_THING}"
  w8_all_namespace "${THIS_NAMESPACE}" 
  #initializer "${this_cwd}/init/${THIS_THING}"
}
time main
