#!/usr/bin/env bash
source ./src/util.bash
source src/sourceror.bash
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/util.bash
source ./src/argoRunner.sh
this_cwd=$(pwd)
printenv
