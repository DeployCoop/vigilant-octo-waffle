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

admin_pass=$(yq '.data|."argocdadmin-password"' ${SECRET_FILE}|sed 's/"//g'|base64 -d)
admin_pass=${admin_pass//$'\n'/}
hash_pass=$(argocd account bcrypt --password ${admin_pass})
time main

