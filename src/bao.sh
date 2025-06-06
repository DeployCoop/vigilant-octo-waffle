#!/usr/bin/env bash
THIS_THING=bao
source ./src/common.sh


main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu

  initializer "${this_cwd}/init/bao"
  argoRunner "$THIS_THING"
}

time main
