#!/usr/bin/env bash
THIS_THING=drupal
source ./src/common.sh


main () {
  echo one
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  argoRunner "${THIS_THING}"
  #initializer "${this_cwd}/init/${THIS_THING}"
}

time main
