#!/usr/bin/env bash
source ./src/w8.bash
source ./src/initializer.bash
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
