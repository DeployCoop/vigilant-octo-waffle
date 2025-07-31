#!/usr/bin/env bash
THIS_THING=openebs
source src/common.sh
set -eux
main () {
  #set -eux
  set -eu

  kubectl krew install mayastor openebs
  argoRunner "$THIS_THING"
  set +e
  w8_pod ${THIS_NAMESPACE} openebs-${THIS_NAME}-localpv-provisioner
  w8_pod ${THIS_NAMESPACE} openebs-${THIS_NAME}-lvm-localpv-controller
  w8_pod ${THIS_NAMESPACE} openebs-${THIS_NAME}-lvm-localpv-node
  set -e
  initializer "$this_cwd/init/openebs"
}

time main
