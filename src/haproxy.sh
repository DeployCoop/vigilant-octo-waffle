#!/usr/bin/env bash
source ./src/sourceror.bash
HAPROXY_INSTALL_TMP=$(mktemp)
trap 'rm ${HAPROXY_INSTALL_TMP}' EXIT
envsubst < "${HAPROXY_CONFIG_TPL}" > "${HAPROXY_INSTALL_TMP}"
#helm upgrade --install haproxy-kubernetes-ingress haproxytech/kubernetes-ingress \
helm upgrade --install haproxy-kubernetes-ingress kubernetes-ingress \
  --repo https://haproxytech.github.io/helm-charts \
  --wait \
  --set controller.image.tag=3.0 \
  --namespace ingress-haproxy --create-namespace \
  -f ${HAPROXY_INSTALL_TMP}

source ./src/w8.bash
w8_all_namespace "${THIS_NAMESPACE}"
#w8_pod ingress-haproxy ingress-haproxy-controller
#w8_pod kube-system svclb-ingress-haproxy-controller
