#!/bin/sh
set -eux
source ./initializer.bash
#helm repo add openebs https://openebs.github.io/openebs
helm upgrade --install \
  openebs openebs \
  --namespace openebs --create-namespace \
  --repo https://openebs.github.io/openebs  \
  -f openebs-values.yaml
kubectl apply -f openebs-sc.yaml
