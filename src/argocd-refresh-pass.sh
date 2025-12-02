#!/usr/bin/env bash
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -u
  countzero=0
  result=1
  set +e
  admin_pass=$(kubectl get secret -n ${THIS_NAME} ${THIS_NAME}-secrets -o json|jq -r '.data."argocdadmin-password"'|base64 -d)
  argocd login ${THIS_ARGO_HOST}.${THIS_DOMAIN} \
    --password  ${admin_pass} \
    --username admin \
    --grpc-web
}

time main
