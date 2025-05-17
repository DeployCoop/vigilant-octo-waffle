#!/usr/bin/env bash
THIS_THING=nextjs-docker
set -eu
source .env
set -x

main () {
  envsubst < argo/${THIS_THING}/argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -
}

time main
