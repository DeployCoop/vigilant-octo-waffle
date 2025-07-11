#!/usr/bin/env bash
set -e 
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  sleep 5
  echo "argocd admin initial-password -n argocd"
  echo 'w8 argocd'
  if [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    w8_ingress argocd argocd-server-ingress 
  elif [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    echo 'w8 wip'
    sleep 5
  fi
  sleep 15
  echo 'init argo pass'
  src/argocd-init-pass.sh
}

time main
