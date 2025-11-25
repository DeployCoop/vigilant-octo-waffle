#!/usr/bin/env bash
THIS_THING=openebs
source src/common.sh
set -eux
main () {
  #set -eux
  set -eu

  src/kmod.sh nvme_tcp
  #kubectl krew install mayastor openebs
  if [[ ${THIS_OPENEBS_INSTALL_METHOD} == "argocd" ]]; then
    argoRunner "$THIS_THING"
  elif [[ ${THIS_OPENEBS_INSTALL_METHOD} == "helm" ]]; then
    OPENEBS_INSTALL_TMP=$(mktemp)
    envsubst '${THIS_OPENEBS_ENGINE_LVM} ${THIS_OPENEBS_ENGINE_ZFS} ${THIS_OPENEBS_ENGINE_MAYASTOR} ${THIS_DEFAULT_STORAGE_SIZE}' \
      < src/openebs-values.tpl \
      > ${OPENEBS_INSTALL_TMP}
    helm install openebs \
      --namespace openebs \
      openebs/openebs \
      --create-namespace \
      -f ${OPENEBS_INSTALL_TMP}
      #-f src/openebs-values.yaml
  else
    echo 'unknown installation method'
    exit 1
  fi
  set +e
  w8_pod ${THIS_OPENEBS_NAMESPACE} openebs-${THIS_NAME}-localpv-provisioner
  w8_pod ${THIS_OPENEBS_NAMESPACE} openebs-${THIS_NAME}-lvm-localpv-controller
  w8_pod ${THIS_OPENEBS_NAMESPACE} openebs-${THIS_NAME}-lvm-localpv-node
  set -e
  initializer "$this_cwd/init/openebs"
}

time main


