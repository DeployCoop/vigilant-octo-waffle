#!/usr/bin/env bash
set -e 
source .env
source ./src/w8.bash
source ./src/initializer.bash
this_cwd=$(pwd)

main () {
  #set -eux
  set -eu

  echo 'sometimes github.com fails to resolve if these creates hit too quick'
  echo 'still investigating as to what is causing it'
  echo "run this script ($0) again after a slight rest if this fails"
  sleep 5

  ${this_cwd}/src/harbor.sh
  envsubst < argo/kube-prometheus-stack/argocd.yaml | argocd app create --name example-prometheus-stack --grpc-web -f - 
  ${this_cwd}/src/openldap.sh
  envsubst < argo/nc/argocd.yaml | argocd app create --name examplenc --grpc-web -f -
  envsubst < argo/supabase/argocd.yaml | argocd app create --name supabase --grpc-web -f -
  envsubst < argo/bao/argocd.yaml | argocd app create --name openbao --grpc-web -f -
  #kubectl apply -f openbaoui-ingress.yaml
  initializer "${this_cwd}/init/bao"
  ${this_cwd}/src/nextjs-docker.sh
}

time main
