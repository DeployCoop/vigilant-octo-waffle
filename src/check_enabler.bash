#!/usr/bin/env bash
: "${ENABLER:=.env.enabler}"

# Check if the application is enabled via .env.enabler
check_enabler () {
  if [[ ! -f "$ENABLER" ]]; then
    echo "WARN:No enabler file found. Running all applications." >&2
    THIS_ENABLED=true
    return 0
  else
    set -a && source ${ENABLER} && set +a
  fi
  if [[ "${VERBOSITY}" -gt "99" ]] ; then
    set -x
  fi
  varname=$(echo ${THIS_THING}_ENABLED | tr '[:lower:]' '[:upper:]' | tr '-' '_' )
  if [[ ! ${!varname} == 'true' ]]; then
    echo "${varname} is not enabled check ${ENABLER}"
    exit 0
    THIS_ENABLED=false
  else
    THIS_ENABLED=true
  fi
}
