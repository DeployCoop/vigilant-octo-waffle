#!/usr/bin/env bash
source src/sourceror.bash
set -eu
export this_cwd=$(pwd)
if [[ ${THIS_ARGO_METHOD} == 'helm' ]]; then
  helm delete argocd
else
  kubectl delete -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
  kubectl delete namespace argocd
fi
