#!/bin/bash
: ${DEBUG:='false'}
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

  these_files=$(find ${THIS_INIT} -iname '*.yaml')
  for f in ${these_files[@]}; do
    echo "subbing ${f}"
    if [[ "${DEBUG}" == "true" ]]; then
      envsubst < ${f}
    fi
    envsubst < ${f} | kubectl apply -f -
  done
}

check_docker () {
docker ps
if [[ ! $? -eq 0 ]]; then
  sudo systemctl restart docker
  sleep 2
fi
}
