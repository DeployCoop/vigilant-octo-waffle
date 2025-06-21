#!/usr/bin/env bash
THIS_THING=opensearch
source src/common.sh
source src/sourceror.bash
PASS_LENGTH=33
if [[ -z ${THIS_OPENSEARCH_ADMIN_PASSWORD} ]]; then
  echo 'WARN: env var THIS_OPENSEARCH_ADMIN_PASSWORD not set generating a random password!'
  export THIS_OPENSEARCH_ADMIN_PASSWORD=$(pwgen -y -c ${PASS_LENGTH} 1)
   pwgen -y -c 23 1
fi
export THIS_OPENSEARCH_ADMIN_PASSHASH=$(src/opensearch-hashpass.py ${THIS_OPENSEARCH_ADMIN_PASSWORD})

opensearch_initial_admin_secret_maker () {
  local secret_name=$1
  local secret_pass=$2
  kubectl create secret generic \
    "${secret_name}" \
    -n "${THIS_NAMESPACE}" \
    --from-literal=OPENSEARCH_INITIAL_ADMIN_PASSWORD="${secret_pass}"
}

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -eu
  opensearch_initial_admin_secret_maker "${THIS_OPENSEARCH_ADMIN_CRED_SECRET}" "${THIS_OPENSEARCH_ADMIN_PASSWORD}"
  argoRunner "${THIS_THING}"
}
time main
