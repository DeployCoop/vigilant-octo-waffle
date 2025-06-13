#!/usr/bin/env bash
THIS_THING=opensearch-operator
source src/common.sh
source src/sourceror.sh
PASS_LENGTH=33
if [[ -z ${THIS_OPENSEARCH_ADMIN_PASSWORD} ]]; then
  echo 'WARN: env var THIS_OPENSEARCH_ADMIN_PASSWORD not set generating a random password!'
  export THIS_OPENSEARCH_ADMIN_PASSWORD=$(pwgen -y -c ${PASS_LENGTH} 1)
   pwgen -y -c 23 1
fi
if [[ -z ${THIS_OPENSEARCH_ADMIN_PASSWORD} ]]; then
  echo 'WARN: env var THIS_OPENSEARCH_DASHUSER_PASSWORD not set generating a random password!'
  export THIS_OPENSEARCH_DASHUSER_PASSWORD=$(pwgen -y -c ${PASS_LENGTH} 1)
fi
export THIS_OPENSEARCH_ADMIN_PASSHASH=$(src/opensearch-hashpass.py ${THIS_OPENSEARCH_ADMIN_PASSWORD})
export THIS_OPENSEARCH_DASHUSER_PASSHASH=$(src/opensearch-hashpass.py ${THIS_OPENSEARCH_DASHUSER_PASSWORD})
secret_maker () {
  local secret_name=$1
  local secret_user=$2
  local secret_pass=$3
  kubectl create secret generic \
    "${secret_name}" \
    -n "${THIS_NAMESPACE}" \
    --from-literal=username="${THIS_OPENSEARCH_ADMIN_USER}" \
    --from-literal=password="${THIS_OPENSEARCH_ADMIN_PASSWORD}"
}

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  secret_maker "${THIS_OPENSEARCH_ADMIN_CRED_SECRET}" "${THIS_OPENSEARCH_ADMIN_USER}" "${THIS_OPENSEARCH_ADMIN_PASSWORD}"
  secret_maker "${THIS_OPENSEARCH_DASHUSER_CRED_SECRET}" "${THIS_OPENSEARCH_DASHUSER_USER}" "${THIS_OPENSEARCH_DASHUSER_PASSWORD}"
  initializer "${this_cwd}/init/pre-${THIS_THING}"
  argoRunner "${THIS_THING}"
  w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
  initializer "${this_cwd}/init/${THIS_THING}"
}
time main
