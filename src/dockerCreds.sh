#!/usr/bin/env bash
set -a && source ./.env && set +a
kubectl create secret docker-registry harborexamplecomcred \
  -n ${THIS_NAMESPACE} \
  --docker-server=${THIS_EXTERNAL_REGISTRY_HOST} \
  --docker-username=${THIS_EXTERNAL_REGISTRY_USERNAME} \
  --docker-password=${THIS_EXTERNAL_REGISTRY_PASS} \
  --docker-email=${THIS_EXTERNAL_REGISTRY_EMAIL}
