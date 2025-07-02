#!/usr/bin/env bash
THIS_THING=REPLACEME_THING_REPLACEME
source src/common.sh

main () {
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  #w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  #initializer "${this_cwd}/init/${THIS_THING}"
}
time main
