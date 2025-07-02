#!/usr/bin/env bash
THIS_THING=openebs
source src/common.sh

set -eux
#helm repo add openebs https://openebs.github.io/openebs
helm upgrade --install \
  openebs openebs \
  --namespace openebs --create-namespace \
  --repo https://openebs.github.io/openebs  \
  --wait \
  -f src/openebs-values.yaml
set +e
w8_pod openebs openebs-localpv-provisioner
w8_pod openebs openebs-lvm-localpv-controller
w8_pod openebs openebs-lvm-localpv-node
set -e
initializer "$this_cwd/init/openebs"
