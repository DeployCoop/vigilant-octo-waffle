#!/usr/bin/env bash
THIS_THING=fossbilling
set -e 
source ./src/util.bash
check_enabler
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
  argoRunner "${THIS_THING}"
  initializer "${this_cwd}/init/${THIS_THING}"
}

time main
