#!/usr/bin/env bash
TMP=$(mktemp -d)
trap 'rm -Rf $TMP' EXIT
set -eu
set -a && source ./.env && set +a
#set -x
envsubst < argo/argo-cd/values.yaml > "${TMP}/values.yaml"
if [[ ${THIS_ARGO_METHOD} == 'helm' ]]; then
  helm repo add argo https://argoproj.github.io/argo-helm
  helm repo update
  helm install archocd argo/argo-cd -f "${TMP}/values.yaml"
else
  #kubectl delete -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
  kubectl create namespace argocd
  kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
fi

echo argocd admin initial-password -n argocd
