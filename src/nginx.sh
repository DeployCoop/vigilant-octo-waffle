#!/usr/bin/env bash
source ./src/sourceror.bash
TMP=$(mktemp)
trap 'rm ${TMP}' EXIT
envsubst < ${NGINX_CONFIG_TPL} > ${TMP}

kubectl apply -f init/raymii-mosquitto_nginx/configmap.yaml
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --wait \
  --namespace ingress-nginx --create-namespace \
  -f ${TMP}

source ./src/w8.bash
w8_pod ingress-nginx ingress-nginx-controller
w8_pod kube-system svclb-ingress-nginx-controller
