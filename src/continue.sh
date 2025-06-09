#!/usr/bin/env bash
: "${BIG_LIST:=./src/big_list}"
set -e 
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
source ./src/util.bash
this_cwd=$(pwd)

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  para_runner "${BIG_LIST}"
}

time main
