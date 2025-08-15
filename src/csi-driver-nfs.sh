#!/usr/bin/env bash
THIS_THING=csi-driver-nfs
source src/common.sh

main () {
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  initializer "${this_cwd}/init/pre-csi-nfs"
  argoRunner "${THIS_THING}"
  #w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  #initializer "${this_cwd}/init/${THIS_THING}"
}
time main
