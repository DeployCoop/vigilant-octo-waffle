#!/usr/bin/env bash
THIS_THING=kubegres
source src/common.sh

kubectl delete -f https://raw.githubusercontent.com/reactive-tech/kubegres/v1.19/kubegres.yaml
kubectl delete Kubegres -n ${THIS_NAMESPACE} ${THIS_NAME}-postgres
