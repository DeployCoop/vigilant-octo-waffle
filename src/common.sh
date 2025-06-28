#!/usr/bin/env bash
set -e 
source ./src/util.bash
check_enabler
if [[ ! $THIS_ENABLED == 'true' ]]; then
  exit 0
fi
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/argoRunner.sh
this_cwd=$(pwd)
