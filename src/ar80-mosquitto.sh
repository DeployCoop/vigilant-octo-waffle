#!/usr/bin/env bash
THIS_THING=ar80-mosquitto
source src/common.sh

main () {
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  #initializer "${this_cwd}/init/${THIS_THING}"
  if [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    echo 'unimplemented'
    exit 1
    initializer "${this_cwd}/init/${THIS_THING}_traefik"
  elif [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    initializer "${this_cwd}/init/${THIS_THING}_nginx"
  elif [[ ${THIS_CLUSTER_INGRESS} == "haproxy" ]]; then
    echo 'unimplemented'
    exit 1
    initializer "${this_cwd}/init/${THIS_THING}_haproxy"
  else
    echo 'unrecognized ingress'
    exit 1
  fi
  w8_pod "${THIS_NAMESPACE}" "${THIS_THING}-${THIS_NAME}"
  w8_all_namespace "${THIS_NAMESPACE}" 
}
time main
