#!/usr/bin/env bash

argoRunner () {

if [[ $# -eq 1 ]]; then
  THIS_THING=$1
else
  echo "wrong number of args $#"
  exit 1
fi
set -eu
set -a && source ./.env && set +a
set -x
envsubst < argo/${THIS_THING}/argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -

}
