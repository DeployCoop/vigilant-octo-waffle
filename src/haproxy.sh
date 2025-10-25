#!/usr/bin/env bash
source ./src/sourceror.bash
TMP=$(mktemp)
trap 'rm ${TMP}' EXIT
envsubst < ${HAPROXY_CONFIG_TPL} > ${TMP}
#helm upgrade --install haproxy-kubernetes-ingress haproxytech/kubernetes-ingress \
helm upgrade --install haproxy-kubernetes-ingress kubernetes-ingress \
  --repo https://haproxytech.github.io/helm-charts \
  --wait \
  --set controller.image.tag=3.0 \
  --namespace ingress-haproxy --create-namespace \
  -f src/ingress-haproxy-values.yaml

source ./src/w8.bash
#w8_pod ingress-haproxy ingress-haproxy-controller
#w8_pod kube-system svclb-ingress-haproxy-controller
