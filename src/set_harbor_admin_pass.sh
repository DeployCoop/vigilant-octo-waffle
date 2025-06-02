#!/usr/bin/env bash
set -eu
set -a && source .env && set +a

updaterrr () {
  HARBOR_ADMIN_PASSWORD=$(kubectl get secret -n example example-secrets -o json|jq -r '.data.HARBOR_ADMIN_PASSWORD'|base64 -d)
  UPDATE_CMD=$(./src/harbor_pass.py "${HARBOR_ADMIN_PASSWORD}")
  #echo kubectl exec -it -n ${THIS_NAMESPACE} goharbor-${THIS_NAME}-database-0 -c database -- ${UPDATE_CMD}
  echo kubectl exec -it -n ${THIS_NAMESPACE} goharbor-${THIS_NAME}-database-0 -c database -- ${UPDATE_CMD} | bash
  #kubectl exec -it -n ${THIS_NAMESPACE} goharbor-${THIS_NAME}-database-0 -c database -- /bin/sh -c "${UPDATE_CMD}"
}

updaterrr
