#!/usr/bin/env bash
THIS_THING=opencti
source src/common.sh
source ./src/sourceror.bash

key_gen () {
  if [[ ! -f "${THIS_OPENCTI_PRIV_KEY_PATH}" ]]; then
    # Generate key
    openssl genrsa -out "${THIS_OPENCTI_PRIV_KEY_PATH}" 4096
  fi

  # Create secret
  kubectl create secret generic xtm-composer-keys \
    --from-file=private_key.pem="${THIS_OPENCTI_PRIV_KEY_PATH}" \
    -n xtm-composer
}

main () {
  set -eu
  initializer "${this_cwd}/init/pre-${THIS_THING}"
  key_gen
  TMP=$(mktemp)
  envsubst < "${THIS_OPENCTI_CONFIG_TPL}" > "${TMP}"
  kubectl create configmap xtm-composer-config \
  --from-file=default.yaml="${TMP}" \
  -n xtm-composer
  rm "${TMP}"
  #argoRunner "${THIS_THING}"
  initializer "${this_cwd}/init/${THIS_THING}"
  #w8_pod "${THIS_NAMESPACE}" "opensearch-operator-${THIS_NAME}-controller-manager"
}
time main
