#!/usr/bin/env bash
THIS_THING=goharbor
set -e 
set -a && source ./.env && set +a
source ./src/w8.bash
source ./src/initializer.bash
source ./src/argoRunner.sh
this_cwd=$(pwd)


main () {
  #set -eux
  set -eu

  argoRunner "$THIS_THING"
  sleep 3
  # no stop error block for the w8s which might have errant errors as they wait
  set +e
  w8_pod ${THIS_NAMESPACE}  ${THIS_THING}-${THIS_NAME}-database-0
  kubectl_native_wait ${THIS_NAMESPACE} ${THIS_THING}-${THIS_NAME}-database-0
  set -e
  sleep 3
  ./src/set_harbor_admin_pass.sh
}

time main
