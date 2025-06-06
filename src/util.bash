#!/bin/bash
: ${DEBUG:='false'}
: ${ENABLER:='./.env.enabler'}

check_docker () {
docker ps
if [[ ! $? -eq 0 ]]; then
  sudo systemctl restart docker
  sleep 2
fi
}

check_enabler () {
  if [[ -f $ENABLER ]]; then 
    set -a && source ${ENABLER} && set +a
    set -x
    varname=$(echo ${THIS_THING}_ENABLED | tr '[:lower:]' '[:upper:]' | tr '-' '_' )
    if [[ ! ${!varname} == 'true' ]]; then
      echo "${varname} is not enabled check ${ENABLER}"
      exit 0
      THIS_ENABLED=false
    else
      THIS_ENABLED=true
    fi
  else
    echo "WARN: no enabler file running all"
    THIS_ENABLED=true
    sleep 1
  fi
}
