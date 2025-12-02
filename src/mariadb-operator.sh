#!/usr/bin/env bash
THIS_THING=mariadb-operator
source src/common.sh

main () {
  set -eu
  # initializer "${this_cwd}/init/pre-${THIS_THING}"
  ARGOCD_CREATE_APP_EXTRA_ARGS='--helm-skip-crds'
  argoRunner "${THIS_THING}"
  # w8 on mariadb-operator-example-mariadb-operator-webhook
  w8_pod "${THIS_NAMESPACE}" "${THIS_THING}-${THIS_NAME}-${THIS_THING}"
  w8_pod "${THIS_NAMESPACE}" "${THIS_THING}-${THIS_NAME}-${THIS_THING}-webhook"
  w8_pod "${THIS_NAMESPACE}" "${THIS_THING}-${THIS_NAME}-${THIS_THING}-cert"
  w8_all_namespace "${THIS_NAMESPACE}" 
  # I don't like sleeps but the db init keeps on failing despite the above w8s, the webhook does not accept calls until a few seconds go by
  sleep 2
}
time main
