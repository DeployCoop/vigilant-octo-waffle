#!/usr/bin/env bash
THIS_THING=openebs
source src/common.sh
set -eux
#ENV_SUBST_EXCLUDES=$(cat src/default.env|grep -v '^$'|grep -v '^#'|grep -i "${THIS_THING}" |awk '{print $2}'|sed 's/"\${\(.*\):=.*/${\1}/'|tr '\n' ' '|sed "s/^/' /"|sed "s/$/'/")
#OPENEBS_ENVSUBST="envsubst ${ENV_SUBST_EXCLUDES}"
OPENEBS_ENVSUBST=$(mktemp)
OPENEBS_INSTALL_TMP=$(mktemp)
trap "rm -f ${OPENEBS_ENVSUBST} ${OPENEBS_INSTALL_TMP}" EXIT

main () {
  #set -eux
  set -eu

  src/kmod.sh nvme_tcp
  #kubectl krew install mayastor openebs
  echo '#!/bin/sh' > ${OPENEBS_ENVSUBST}
  echo 'set -eux' > ${OPENEBS_ENVSUBST}
  echo 'envsubst \' >> ${OPENEBS_ENVSUBST}
  convert_default_env_to_envsubst >> ${OPENEBS_ENVSUBST}
  echo '< src/openebs-values.tpl \' >> ${OPENEBS_ENVSUBST}
  echo "> ${OPENEBS_INSTALL_TMP}" >> ${OPENEBS_ENVSUBST}

  if [[ ${THIS_OPENEBS_INSTALL_METHOD} == "argocd" ]]; then
    argoRunner "$THIS_THING"
  elif [[ ${THIS_OPENEBS_INSTALL_METHOD} == "helm" ]]; then
    #echo ${ENV_SUBST_EXCLUDES}
    #envsubst ${ENV_SUBST_EXCLUDES} \
    #${OPENEBS_ENVSUBST} \
    #  < src/openebs-values.tpl \
    #  > ${OPENEBS_INSTALL_TMP}
    #cat ${OPENEBS_ENVSUBST} 
    #exit 1
    bash ${OPENEBS_ENVSUBST} 
    helm install openebs-${THIS_NAME} \
      --namespace openebs \
      openebs/openebs \
      --timeout 10m0s \
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
  w8_all_namespace "${THIS_OPENEBS_NAMESPACE}" 
  set -e
  initializer "$this_cwd/init/openebs"
}

time main


