#!/usr/bin/env bash
THIS_THING=openldap
set -e 
set -a && source .env && set +a
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
