#!/usr/bin/env bash
THIS_THING=certmanager
source src/common.sh

set -eu
helm upgrade --install \
  cert-manager cert-manager \
  --repo https://charts.jetstack.io \
  --namespace cert-manager --create-namespace \
  --wait \
  --timeout "${THIS_HELM_TIMEOUT:-15m0s}" \
  --version v1.16.3 \
  --set prometheus.enabled=true \
  --set crds.enabled=true
kubectl -n cert-manager get pod
set +e
src/mkcert.sh
set -e
src/letsencrypt.sh
kubectl get ClusterIssuer -A
