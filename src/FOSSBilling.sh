#!/usr/bin/env bash
THIS_THING=fossbilling
source ./src/common.sh


main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  argoRunner "${THIS_THING}"
  initializer "${this_cwd}/init/${THIS_THING}"
}

time main
