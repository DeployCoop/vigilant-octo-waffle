#!/usr/bin/env bash
source ./src/util.bash
set -a && source ./.env && set +a
this_cwd=$(pwd)

install_traefik_w_helm () {
#helm upgrade --install traefik traefik/traefik \
  TMP=$(mktemp -d)
  trap 'rm -rf ${TMP}' EXIT
  envsubst < src/ingress-traefik-values.yaml > "${TMP}/values.yaml"
  helm upgrade --install traefik traefik \
    --repo https://traefik.github.io/charts \
    --namespace ingress-traefik --create-namespace \
    --wait \
    --debug \
    -f "${TMP}/values.yaml"
}

if [[ ${THIS_TRAEFIK_METHOD} == 'helm' ]]; then
  install_traefik_w_helm
else
  initializer "${this_cwd}/init/traefik"
fi
