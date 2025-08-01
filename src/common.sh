#!/usr/bin/env bash
set -e 
source src/check_enabler.bash

check_enabler

if [[ ! $THIS_ENABLED == 'true' ]]; then
  exit 0
fi
source src/sourceror.bash
this_cwd=$(pwd)
