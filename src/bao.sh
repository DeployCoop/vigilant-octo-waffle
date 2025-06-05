#!/usr/bin/env bash
THIS_THING=bao
set -e 
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
source ./src/argoRunner.sh
this_cwd=$(pwd)


main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu

  initializer "${this_cwd}/init/bao"
  argoRunner "$THIS_THING"
}

time main
