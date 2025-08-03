#!/usr/bin/env bash
helm upgrade --install ingress-nginx ingress-nginx \
  --repo https://kubernetes.github.io/ingress-nginx \
  --wait \
  --namespace ingress-nginx --create-namespace \
  -f src/ingress-nginx-values.yaml

source ./src/w8.bash
w8_pod ingress-nginx ingress-nginx-controller
w8_pod kube-system svclb-ingress-nginx-controller
