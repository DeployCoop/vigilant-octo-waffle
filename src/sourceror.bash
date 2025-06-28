#!/usr/bin/env bash
# load our env file
if [[ -f .env ]]; then
  set -a && source .env && set +a
else
  echo ".env file does not exist, copy .env.example to .env and start there"
fi
# load the defaults which should be ignored 
# if a value was previously set in the .env
  set -a && source ./src/default.env && set +a

source ./src/check_cmd.bash
source ./src/w8.bash
source ./src/util.bash

do_cmd_checks 
