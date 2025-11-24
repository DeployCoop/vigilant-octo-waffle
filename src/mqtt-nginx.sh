#!/usr/bin/env bash
helm upgrade --install ingress-nginx-mqtt ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --wait \
  --namespace ingress-nginx-mqtt --create-namespace \
  -f src/ingress-nginx-mqtt-values.yaml

source ./src/w8.bash
#w8_pod ingress-nginx-mqtt ingress-nginx-controller
#w8_pod kube-system svclb-ingress-nginx-controller
