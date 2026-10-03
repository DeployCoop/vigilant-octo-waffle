#!/usr/bin/env bash
if [[ $# -eq 1 ]]; then
  export TARGET_NAMESPACE=$1
else
  echo "ERROR: wrong number of args: $#"
  exit 1
fi

export THIS_PSS_ENFORCE="${THIS_PSS_ENFORCE:-baseline}"
export THIS_PSS_WARN="${THIS_PSS_WARN:-restricted}"
export THIS_PSS_AUDIT="${THIS_PSS_AUDIT:-restricted}"

# Mark privileged if storage/system namespace
if [[ " kube-system openebs nfs-server longhorn-system seaweedfs cert-manager traefik ingress-nginx " =~ " ${TARGET_NAMESPACE} " ]]; then
  export THIS_PSS_ENFORCE="privileged"
  export THIS_PSS_WARN="baseline"
  export THIS_PSS_AUDIT="baseline"
fi

NAMESPACER_TMP=$(mktemp -d --suffix .tmp.d)
trap 'rm -rf ${NAMESPACER_TMP}' EXIT

envsubst < src/namespacer.tpl > ${NAMESPACER_TMP}/namespacer.yaml
kubectl apply -f ${NAMESPACER_TMP}/namespacer.yaml
