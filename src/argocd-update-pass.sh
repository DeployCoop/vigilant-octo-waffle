#!/usr/bin/env bash
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -u
  argocd account update-password \
    --current-password ${PASSWORD_ARGO} \
    --new-password  ${admin_pass} \
    --grpc-web

  argocd login ${THIS_ARGO_HOST}.${THIS_DOMAIN} \
    --password  ${admin_pass} \
    --username admin \
    --grpc-web
}

time main
