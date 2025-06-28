#!/usr/bin/env bash
set -eux
source ./src/util.bash
helm upgrade --install \
  cert-manager cert-manager \
  --repo https://charts.jetstack.io \
  --namespace cert-manager --create-namespace \
  --wait \
  --version v1.16.3 \
  --set prometheus.enabled=true \
  --set crds.enabled=true
#kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.16.1/cert-manager.crds.yaml
kubectl -n cert-manager get pod
set +e
src/mkcert.sh
set -e
initializer "init/certmanager"
kubectl get ClusterIssuer -A
kubectl describe clusterissuer letsencrypt-staging
kubectl describe clusterissuer letsencrypt-production
kubectl describe clusterissuer mkcert-issuer 
kubectl create deployment nginx --image nginx:alpine 
kubectl expose deployment nginx --port 80 --target-port 80
