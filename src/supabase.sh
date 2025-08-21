#!/usr/bin/env bash
THIS_THING=supabase
source src/common.sh

main () {
  #set -eux
  set -eu
  if [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    initializer "${this_cwd}/init/pre-${THIS_THING}"
  elif [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    echo 'nginx'
  else
    echo 'unrecognized ingress'
    exit 1
  fi
  argoRunner "$THIS_THING"
  #initializer "${this_cwd}/init/${THIS_THING}"
}

time main
