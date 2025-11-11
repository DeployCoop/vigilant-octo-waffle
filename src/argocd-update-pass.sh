#!/usr/bin/env bash
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -u
  PASSWORD_ARGO=$(argocd admin initial-password -n argocd|head -n 1)
  #PASSWORD_ARGO=$(kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 --decode)
  #admin_pass=$(yq '.data|."argocdadmin-password"' ${SECRET_FILE}|sed 's/"//g'|base64 -d)
  admin_pass=$(kubectl get secret -n example example-secrets -o json|jq -r '.data."argocdadmin-password"'|base64 -d)
  #admin_pass=${admin_pass//$'\n'/}
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
