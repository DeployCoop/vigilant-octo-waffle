#!/usr/bin/env bash
source src/util.bash
source src/merge2yaml.bash

argoRunner () {
  ARGORUNNER_TMP=$(mktemp -d --suffix .tmp.d)
  ARGORUNNER_ENVSUBST=${ARGORUNNER_TMP}/envsubst.sh
  ARGORUNNR_INSTALL_TMP=${ARGORUNNER_TMP}/argorunnr.sh
  trap "rm -rf ${ARGORUNNER_TMP}" EXIT
  this_cwd=$(pwd)
  if [[ $# -eq 1 ]]; then
    THIS_THING=$1
  else
    echo "wrong number of args $#"
    exit 1
  fi
  set -eu
  set -a && source ./.env && set +a
  if [[ ${VERBOSITY} -gt 10 ]]; then
    set -x
  fi
  if [[ -f ".argo_overrides/${THIS_THING}/argocd.yaml" ]]; then
    mkdir -p "${ARGORUNNER_TMP}/${THIS_THING}"
    merge2yaml ".argo_overrides/${THIS_THING}/argocd.yaml" "argo/${THIS_THING}/argocd.yaml" > "${ARGORUNNER_TMP}/${THIS_THING}/argocd.yaml"
  else
    cp -a "argo/${THIS_THING}" "${ARGORUNNER_TMP}/"
  fi
  echo '#!/bin/sh' > ${ARGORUNNER_ENVSUBST}
  echo 'set -eu' > ${ARGORUNNER_ENVSUBST}
  echo 'envsubst \' >> ${ARGORUNNER_ENVSUBST}
  #cat src/default.env|grep -v '^$'|grep -v '^#'|awk '{print $2}'|sed 's/"\${\(.*\):=.*/${\1}/'|tr '\n' ' '|sed "s/^/' /"|sed "s/$/'/"| sed 's/$/ \\\n/' >> ${ARGORUNNER_ENVSUBST}
  convert_default_env_to_envsubst >> ${ARGORUNNER_ENVSUBST}
  # Use the generated ArgoCD manifest as the input to envsubst
  echo "< \"${ARGORUNNER_TMP}/${THIS_THING}/argocd.yaml\" \\" >> ${ARGORUNNER_ENVSUBST}
  echo "> ${ARGORUNNR_INSTALL_TMP}" >> ${ARGORUNNER_ENVSUBST}
  #bash ${OPENEBS_ENVSUBST} 
  # envsubst "${ENV_SUBST_EXCLUDES}"
  #   < "${ARGORUNNER_TMP}/${THIS_THING}/argocd.yaml" \
  #   | argocd app create --name "${THIS_THING}" --grpc-web -f -
  #
  #envsubst "${ENV_SUBST_EXCLUDES}"
  bash ${ARGORUNNER_ENVSUBST} 
    < "${ARGORUNNER_TMP}/${THIS_THING}/argocd.yaml"
  argocd app create --name "${THIS_THING}" --grpc-web -f ${ARGORUNNR_INSTALL_TMP}
  cd "${this_cwd}"
}
