#!/usr/bin/env bash
THIS_THING=certmanager
source src/common.sh

set -eu

kubectl apply \
  --server-side \
  -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.4.1/standard-install.yaml

  #--version v1.16.3 \
  #cert-manager oci://quay.io/jetstack/charts/cert-manager \
helm upgrade --install \
  cert-manager cert-manager \
  --repo https://charts.jetstack.io \
  --namespace cert-manager --create-namespace \
  --set config.apiVersion="controller.config.cert-manager.io/v1alpha1" \
  --set config.kind="ControllerConfiguration" \
  --set config.enableGatewayAPI=true \
  --wait \
  --set prometheus.enabled=true \
  --set crds.enabled=true

kubectl -n cert-manager get pod
set +e
src/mkcert.sh
set -e
src/letsencrypt.sh
kubectl get ClusterIssuer -A
