#!/usr/bin/env bash
set -eux
source ./src/initializer.bash
#helm repo add openebs https://openebs.github.io/openebs
helm upgrade --install \
  openebs openebs \
  --namespace openebs --create-namespace \
  --repo https://openebs.github.io/openebs  \
  -f src/openebs-values.yaml
set +e
w8_pod openebs openebs-localpv-provisioner
w8_pod openebs openebs-lvm-localpv-controller
w8_pod openebs openebs-lvm-localpv-node
set -e
initializer "$this_cwd/init/openebs"
