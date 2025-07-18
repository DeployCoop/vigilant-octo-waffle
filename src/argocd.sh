#!/usr/bin/env bash
THIS_THING=argocd
source src/common.sh
export this_cwd=$(pwd)
TMP=$(mktemp -d --suffix .tmp.d )
trap 'rm -rf ${TMP}' EXIT
set -eu
envsubst < argo/argo-cd/values.yaml > "${TMP}/values.yaml"
if [[ ${THIS_ARGO_METHOD} == 'helm' ]]; then
  # helm repo add argo https://argoproj.github.io/argo-helm
  # helm repo update
  # helm install archocd argo/argo-cd \
  # --wait \
  #   -f "${TMP}/values.yaml"
  helm upgrade --install \
    argocd argo-cd \
    --repo https://argoproj.github.io/argo-helm \
    --wait \
    -f "${TMP}/values.yaml"
else
  #kubectl delete -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
  kubectl create namespace argocd
  kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
fi


# no stop error block for the w8s which might have errant errors as they wait
echo "Deploying DeployCoop components:"
if [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
  initializer "$this_cwd/init/argocd_nginx"
elif [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
  initializer "$this_cwd/init/argocd_traefik"
fi

src/prepargo.sh
