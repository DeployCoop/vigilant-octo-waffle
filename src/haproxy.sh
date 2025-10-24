#!/usr/bin/env bash
helm upgrade --install haproxy-kubernetes-ingress haproxytech/kubernetes-ingress \
  --repo https://haproxytech.github.io/helm-charts \
  --wait \
  --set controller.image.tag=3.0 \
  --namespace ingress-haproxy --create-namespace \
  -f src/ingress-haproxy-values.yaml

source ./src/w8.bash
#w8_pod ingress-haproxy ingress-haproxy-controller
#w8_pod kube-system svclb-ingress-haproxy-controller
