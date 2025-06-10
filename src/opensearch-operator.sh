#!/usr/bin/env bash
THIS_THING=opensearch-operator
source ./src/common.sh

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  argoRunner "${THIS_THING}"
  w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  initializer "${this_cwd}/init/${THIS_THING}"
}
time main
