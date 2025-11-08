#!/usr/bin/env bash
set -e 
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  src/wait_argo.sh
  echo 'init argo pass'
  if [[ ${THIS_INIT_ARGO_PASS_METH} == 'argocd' ]]; then
    src/argocd-init-pass.sh
  elif [[ ${THIS_INIT_ARGO_PASS_METH} == 'kubectl' ]]; then
    src/argocd-init-pass-kubectl.sh
  elif [[ ${THIS_INIT_ARGO_PASS_METH} == 'htpasswd' ]]; then
    src/argocd-init-pass-htpasswd.sh
  else
    echo "unknown THIS_INIT_ARGO_PASS_METH ${THIS_INIT_ARGO_PASS_METH}"
    exit 1
  fi
}


time main
exit 0
