#!/usr/bin/env bash
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -u
  countzero=0
  result=1
  kubectl -n argocd patch secret argocd-secret \
    -p "{\"stringData\": {
      \"admin.password\": \"${hash_pass}\",
      \"admin.passwordMtime\": \"$(date +%FT%T%Z)\"
    }}"
}

admin_pass=$(kubectl get secret -n ${THIS_NAME} ${THIS_NAME}-secrets -o json|jq -r '.data."argocdadmin-password"'|base64 -d)
hash_pass=$(argocd account bcrypt --password ${admin_pass})
time main

