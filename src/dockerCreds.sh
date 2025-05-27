#!/usr/bin/env bash
set -a && source ./.env && set +a

kubectl get secrets -n ${THIS_NAMESPACE} ${THIS_EXTERNAL_REGISTRY_SECRET} &> /dev/null
if [[ $? -eq 0 ]]; then
  echo 'WARN: secret already exists.'
  exit 0
else
  kubectl create secret docker-registry ${THIS_EXTERNAL_REGISTRY_SECRET} \
  -n ${THIS_NAMESPACE} \
  --docker-server=${THIS_EXTERNAL_REGISTRY_HOST} \
  --docker-username=${THIS_EXTERNAL_REGISTRY_USERNAME} \
  --docker-password=${THIS_EXTERNAL_REGISTRY_PASS} \
  --docker-email=${THIS_EXTERNAL_REGISTRY_EMAIL}
fi
exit 0
