#!/usr/bin/env bash
THIS_THING=velero
source src/common.sh

main () {
  set -eu
  #initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  #initializer "${this_cwd}/init/${THIS_THING}"
  w8_pod "velero" "velero-${THIS_NAMESPACE}"
  velero plugin add openebs/velero-plugin:1.9.0 --confirm
}
time main
