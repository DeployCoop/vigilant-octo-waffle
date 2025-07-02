#!/usr/bin/env bash
THIS_THING=kubegres
source src/common.sh

initializer "$this_cwd/init/kubegres"
sleep 1
kubectl apply -f https://raw.githubusercontent.com/reactive-tech/kubegres/v1.19/kubegres.yaml
set +e
w8_pod kubegres-system kubegres-controller-manager
# wait on kubegres to settle
sleep 2
kubectl_native_wait kubegres-system $(kubectl get po -n kubegres-system|grep kubegres-controller-manager|cut -f1 -d ' ')
set -e
initializer "$this_cwd/init/postgres"
sleep 2
set +e 
w8_pod "${THIS_NAMESPACE}" "${THIS_NAME}-postgres-1-0"
set -e 
