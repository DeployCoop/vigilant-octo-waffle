#!/usr/bin/env bash
set -e 
source .env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu

  envsubst < argo/openldap/argocd.yaml | argocd app create --name example-openldap --grpc-web -f -
}

time main
