#!/usr/bin/env bash
set -e 
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  sleep 5
  src/wait_argo.sh
  echo 'init argo pass'
  if [[ ${THIS_INIT_ARGO_PASS_METH} == 'argocd' ]]; then
    src/argocd-init-pass-argocd.sh
  elif [[ ${THIS_INIT_ARGO_PASS_METH} == 'bcrypt' ]]; then
    src/argocd-init-pass-kubectl.sh
  elif [[ ${THIS_INIT_ARGO_PASS_METH} == 'patch-file' ]]; then
    src/argocd-init-pass-patch-file.sh
  elif [[ ${THIS_INIT_ARGO_PASS_METH} == 'htpasswd' ]]; then
    src/argocd-init-pass-htpasswd.sh
  else
    echo "unknown THIS_INIT_ARGO_PASS_METH ${THIS_INIT_ARGO_PASS_METH}"
    exit 1
  fi
  argocd-update-pass.sh
}


time main
exit 0
