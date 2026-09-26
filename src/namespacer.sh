#!/usr/bin/env bash
if [[ $# -eq 1 ]]; then
  export TARGET_NAMESPACE=$1
else
  echo "ERROR: wrong number of args: $#command"
  exit 1
fi

NAMESPACER_TMP=$(mktemp -d --suffix .tmp.d)
trap 'rm -rf ${NAMESPACER_TMP}' EXIT

envsubst < src/namespacer.tpl > ${NAMESPACER_TMP}/namespacer.yaml
kubectl apply -f ${NAMESPACER_TMP}/namespacer.yaml
