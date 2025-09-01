#!/usr/bin/env bash
THIS_THING=gpu-operator
source src/common.sh

main () {
  set -eu
  initializer "${this_cwd}/init/pre-${THIS_THING}"
  kubectl label --overwrite ns gpu-operator pod-security.kubernetes.io/enforce=privileged
  argoRunner "${THIS_THING}"
  #w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  #initializer "${this_cwd}/init/${THIS_THING}"
}
time main
