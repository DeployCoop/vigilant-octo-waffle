#!/usr/bin/env bash
set -e 
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  sleep 5
  echo 'w8 argocd'
  w8_pod argocd argocd-redis-
  w8_pod argocd argocd-repo-server-
  w8_pod argocd argocd-server-
  w8_pod argocd argocd-application-controller-
  w8_pod argocd argocd-dex-server-
  if [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    w8_ingress argocd argocd-server-ingress 
  elif [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    echo 'w8 wip'
    sleep 5
  elif [[ ${THIS_CLUSTER_INGRESS} == "haproxy" ]]; then
    echo 'w8 wip'
    sleep 5
  fi
}


time main
