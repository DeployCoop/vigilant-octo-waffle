#!/usr/bin/env bash
# load our env file
if [[ -f .env ]]; then
  set -a && source .env && set +a
else
  echo "WARN: .env file does not exist, copy .env.example to .env and start there"
fi
if [[ ${VERBOSITY} -gt ${THIS_DEBUG_THRESH} ]]; then
  set -x
fi
# load the defaults which should be ignored 
# if a value was previously set in the .env
  set -a && source ./src/default.env && set +a
# set the ENV_SUBST_EXCLUDES
#intermediary_string=$(cat src/default.env|grep -v '^$'|grep -v '^#'|awk '{print $2}'|sed 's/"\${\(.*\):=.*/${\1}/'|tr '\n' ' '|sed "s/^/' /"|sed "s/$/'/")
#ENV_SUBST_EXCLUDES=$(printf "'%s'" $intermediary_string)
#ENV_SUBST_EXCLUDES="$(printf "%s" $intermediary_string)"


source ./src/argoRunner.bash
source ./src/check_cmd.bash
source ./src/squawk.bash
source ./src/util.bash
source ./src/w8.bash

do_cmd_checks 
