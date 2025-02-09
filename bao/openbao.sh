#!/bin/bash
#https://openbao.org/docs/platform/k8s/helm/
#helm repo add openbao https://openbao.github.io/openbao-helm
#helm search repo openbao/openbao
argocd app create -f openbao-argo-deployment.yaml --name openbao
