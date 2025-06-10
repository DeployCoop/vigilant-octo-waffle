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

para_runner () {
: "${PARALLEL_JOBS:=5}"
  TARGET=$1
  if [[ "${VERBOSITY}" -gt "9" ]] ; then
    cat "${TARGET}"
  fi
  if [[ "${PARALLEL_JOBS}" -gt "1" ]] ; then
    parallel -j ${PARALLEL_JOBS} -- < "${TARGET}"
  else
    bash "${TARGET}"
  fi
}

initializer () {
  if [[ ! $# -eq 1 ]]; then
    echo "useage: $0 INIT_DIR"
    exit 1
  else
    THIS_INIT=$1
  fi
  if [[ ! -d ${THIS_INIT} ]]; then
    echo "${THIS_INIT} is not a directory!"
    exit 1

  fi

  these_files=$(find ${THIS_INIT} -regex '.*.ya?ml'|sort)
  for f in ${these_files[@]}; do
    echo "subbing ${f}"
    if [[ "${DEBUG}" == "true" ]]; then
      envsubst < ${f}
    fi
    envsubst < ${f} | kubectl apply -f -
  done
}
