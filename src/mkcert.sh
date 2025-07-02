#!/usr/bin/env bash
THIS_THING=mkcert
source src/common.sh

set -eu

kubectl create secret tls mkcert-ca-key-pair \
--key "$(mkcert -CAROOT)"/rootCA-key.pem \
--cert "$(mkcert -CAROOT)"/rootCA.pem -n cert-manager

initializer "init/certmanager-mkcert"
sleep 2
kubectl describe clusterissuer mkcert-issuer 
