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
  while [[ ! $result -eq 0 ]]; do
    argocd admin initial-password -n argocd
    result=$?
    if [[ $countzero -gt 9 ]]; then
      break
    fi
    sleep 3
  done
  PASSWORD_ARGO=$(argocd admin initial-password -n argocd|head -n 1)
  #PASSWORD_ARGO=$(kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 --decode)

  #set -x
  countzero=0
  result=1
  while [[ ! $result -eq 0 ]]; do
    argocd login ${THIS_ARGO_HOST}.${THIS_DOMAIN} \
      --password ${PASSWORD_ARGO} \
      --username admin \
      --grpc-web
    result=$?
    if [[ $countzero -gt 9 ]]; then
      break
    fi
    sleep 3
  done
  set -e

  admin_pass=$(yq '.data|."argocdadmin-password"' ${SECRET_FILE}|sed 's/"//g'|base64 -d)
  admin_pass=${admin_pass//$'\n'/}

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
