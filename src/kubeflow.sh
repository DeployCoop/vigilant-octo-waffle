#!/usr/bin/env bash
THIS_THING=kubeflow
source src/common.sh

main () {
  set -eu
  # Depending on what your thing is you might use a mix of these lines
  #
  # initializer "${this_cwd}/init/pre-${THIS_THING}"
  # ARGOCD_CREATE_APP_EXTRA_ARGS='--helm-skip-crds'
  # argoRunner "${THIS_THING}"
  # w8_pod "${THIS_NAMESPACE}" "${THIS_THING}-${THIS_NAME}"
  # export PIPELINE_VERSION=2.14.3
  kubectl apply -k "github.com/kubeflow/pipelines/manifests/kustomize/cluster-scoped-resources?ref=$PIPELINE_VERSION"
  kubectl wait --for condition=established --timeout=60s crd/applications.app.k8s.io
  kubectl apply -k "github.com/kubeflow/pipelines/manifests/kustomize/env/platform-agnostic?ref=$PIPELINE_VERSION"
  initializer "${this_cwd}/init/${THIS_THING}"
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
  # w8_all_namespace "${THIS_NAMESPACE}" 
}
time main
