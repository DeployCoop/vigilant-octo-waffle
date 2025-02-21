#!/bin/bash
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

  envsubst < kube-prometheus-stack/argocd.yaml | argocd app create --name example-prometheus-stack --grpc-web -f - 
  envsubst < openldap/argocd.yaml | argocd app create --name example-openldap --grpc-web -f -
  envsubst < nc/argocd.yaml | argocd app create --name examplenc --grpc-web -f -
  envsubst < bao/openbao-argo-deployment.yaml | argocd app create --name openbao --grpc-web -f -
  #kubectl apply -f openbaoui-ingress.yaml
  initializer ${this_cwd}/src/bao_init
}

time main
