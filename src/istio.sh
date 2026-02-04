#!/usr/bin/env bash
THIS_THING=istio
source src/common.sh

main () {
  set -eu
  # Depending on what your thing is you might use a mix of these lines
  #
  # initializer "${this_cwd}/init/pre-${THIS_THING}"
  # ARGOCD_CREATE_APP_EXTRA_ARGS='--helm-skip-crds'
  # argoRunner "${THIS_THING}"
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
  istioctl install \
    --set profile=${THIS_ISTIO_PROFILE} \
    ${ISTIOCTL_EXTRA_ARGS} \
    --skip-confirmation
  sleep 5
  w8_all_namespace "${THIS_NAMESPACE}" 
}
time main
