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

  echo 'sometimes github.com fails to resolve if these creates hit too quick'
  echo 'still investigating as to what is causing it'
  echo "run this script ($0) again after a slight rest if this fails"
  sleep 1

  set -u
  cd "${this_cwd}"


  para_runner "${BIG_LIST}"
}

time main
