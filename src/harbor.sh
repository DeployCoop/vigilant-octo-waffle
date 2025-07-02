#!/usr/bin/env bash
THIS_THING=goharbor
source ./src/common.sh

main () {
  #set -eux
  set -eu

  argoRunner "$THIS_THING"
  sleep 5
  # no stop error block for the w8s which might have errant errors as they wait
  set +e
  w8_pod ${THIS_NAMESPACE}  ${THIS_THING}-${THIS_NAME}-database-0
  kubectl_native_wait ${THIS_NAMESPACE} ${THIS_THING}-${THIS_NAME}-database-0
  sleep 2
  ./src/test_harbor_db.sh
  set -e
  ./src/set_harbor_admin_pass.sh
}

time main
