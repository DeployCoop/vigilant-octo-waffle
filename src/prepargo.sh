#!/usr/bin/env bash
set -e 
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu
  sleep 5


  echo 'w8 argocd'
  if [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    w8_ingress argocd argocd-server-ingress 
  elif [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    echo 'w8 wip'
    sleep 5
  fi
  sleep 15
  echo 'init argo pass'
  cd $this_cwd
  ./src/argocd-init-pass.sh
  ./src/continue.sh
}

time main
