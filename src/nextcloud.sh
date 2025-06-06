#!/usr/bin/env bash
THIS_THING=nextcloud
set -e 
source ./src/util.bash
check_enabler
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
source ./src/argoRunner.sh
this_cwd=$(pwd)


main () {
  #set -eux
  set -eu

  argoRunner "$THIS_THING"
}

time main
