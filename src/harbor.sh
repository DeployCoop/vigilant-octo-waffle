#!/usr/bin/env bash
set -e 
source .env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu

  envsubst < argo/goharbor/argocd.yaml | argocd app create --name supabase --grpc-web -f -
  sleep 3
  # no stop error block for the w8s which might have errant errors as they wait
  set +e
  w8_pod ${THIS_NAMESPACE}  goharbor-${THIS_NAME}-database-0
  kubectl_native_wait ${THIS_NAMESPACE} goharbor-${THIS_NAME}-database-0
  set -e
  sleep 3
  ./src/set_harbor_admin_pass.sh
}

time main
