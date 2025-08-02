#!/usr/bin/env bash
THIS_THING=traefik
source src/sourceror.bash
TMP=$(mktemp -d --suffix .tmp.d )
trap 'rm -rf ${TMP}' EXIT
this_cwd=$(pwd)

main () {
  source src/common.sh
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  #w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  #initializer "${this_cwd}/init/${THIS_THING}"
}


install_traefik_w_helm () {
#helm upgrade --install traefik traefik/traefik \
  envsubst < src/ingress-traefik-values.yaml > "${TMP}/values.yaml"
  helm upgrade --install traefik traefik \
    --repo https://traefik.github.io/charts \
    --namespace traefik --create-namespace \
    --wait \
    --debug \
    -f "${TMP}/values.yaml"
}

# https://doc.traefik.io/traefik/providers/kubernetes-crd/
# Install Traefik Resource Definitions:
kubectl apply -f https://raw.githubusercontent.com/traefik/traefik/v3.5/docs/content/reference/dynamic-configuration/kubernetes-crd-definition-v1.yml

# Install RBAC for Traefik:
kubectl apply -f https://raw.githubusercontent.com/traefik/traefik/v3.5/docs/content/reference/dynamic-configuration/kubernetes-crd-rbac.yml

initializer "${this_cwd}/init/middlewares"
if [[ ${THIS_TRAEFIK_METHOD} == 'helm' ]]; then
  install_traefik_w_helm
elif [[ ${THIS_TRAEFIK_METHOD} == 'main' ]]; then
  echo  "WARN: chicken vs egg problem with argo, you should have another ingress already setup before argo"
  sleep 2
  time main
else
  initializer "${this_cwd}/init/traefik"
fi
