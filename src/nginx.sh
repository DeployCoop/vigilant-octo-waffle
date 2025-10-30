#!/usr/bin/env bash
THIS_THING=nginx
source ./src/sourceror.bash
this_cwd=$(pwd)
NGINX_INSTALL_TMP=$(mktemp)
trap 'rm ${NGINX_INSTALL_TMP}' EXIT
envsubst < "${NGINX_CONFIG_TPL}" > "${NGINX_INSTALL_TMP}"

initializer "${this_cwd}/init/pre-${THIS_THING}"

kubectl apply -f init/raymii-mosquitto_nginx/configmap.yaml
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --wait \
  --namespace ingress-nginx --create-namespace \
  -f ${NGINX_INSTALL_TMP}

source ./src/w8.bash
w8_pod ingress-nginx ingress-nginx-controller
w8_pod kube-system svclb-ingress-nginx-controller
