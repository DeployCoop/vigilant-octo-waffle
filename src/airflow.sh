#!/usr/bin/env bash
THIS_THING=airflow
source src/common.sh

main () {
  set -eu
  # Depending on what your thing is you might use a mix of these lines
  #
  # initializer "${this_cwd}/init/pre-${THIS_THING}"
  # ARGOCD_CREATE_APP_EXTRA_ARGS='--helm-skip-crds'
  #src/mksecret.sh "${THIS_AIRFLOW_ROOT_SECRET}" "${THIS_AIRFLOW_ROOT_KEY}" "${THIS_AIRFLOW_ROOT_PASSWORD}"
  src/mksecret.sh "${THIS_AIRFLOW_FERNET_SECRET}" "${THIS_AIRFLOW_FERNET_KEY}" "${THIS_AIRFLOW_FERNET_PASSWORD}"
  src/mksecret.sh "${THIS_AIRFLOW_REDIS_SECRET}" "${THIS_AIRFLOW_REDIS_KEY}" "${THIS_AIRFLOW_REDIS_PASSWORD}"
  argoRunner "${THIS_THING}"
  w8_all_namespace "${THIS_NAMESPACE}" 
  # w8_pod "${THIS_NAMESPACE}" "${THIS_THING}-${THIS_NAME}"
  # initializer "${this_cwd}/init/${THIS_THING}"
  # if [[ ${THIS_CLUSTER_INGRESS} == "traefik" ]]; then
  #   initializer "${this_cwd}/init/${THIS_THING}_traefik"
  # elif [[ ${THIS_CLUSTER_INGRESS} == "nginx" ]]; then
  #   echo 'unimplemented'
  #   exit 1
  #   initializer "${this_cwd}/init/${THIS_THING}_nginx"
  # elif [[ ${THIS_CLUSTER_INGRESS} == "haproxy" ]]; then
  #   echo 'unimplemented'
  #   exit 1
  #   initializer "${this_cwd}/init/${THIS_THING}_haproxy"
  # else
  #   echo 'unrecognized ingress'
  #   exit 1
  # fi
}
time main
