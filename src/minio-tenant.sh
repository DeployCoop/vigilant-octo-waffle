#!/usr/bin/env bash
THIS_THING=minio-tenant
source src/common.sh

main () {
  set -eu
  if [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
    initializer "${this_cwd}/init/pre-${THIS_THING}-traefik"
  elif [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
    echo 'ingress nginx is good to go'
  else
    echo 'unrecognized ingress'
    exit 1
  fi
  initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  #w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  #initializer "${this_cwd}/init/${THIS_THING}"
}
time main
