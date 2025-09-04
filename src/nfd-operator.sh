#!/usr/bin/env bash
THIS_THING=nfd-operator
source src/common.sh
# https://operatorhub.io/operator/nfd-operator
main () {
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  #argoRunner "${THIS_THING}"
  #kubectl create -f https://operatorhub.io/install/nfd-operator.yaml
  w8_pod "operators" "nfd-controller-manager"
  initializer "${this_cwd}/init/${THIS_THING}"
}
time main
