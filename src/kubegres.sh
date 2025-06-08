#!/usr/bin/env bash
initializer "$this_cwd/init/postgres"
sleep 2
kubectl apply -f https://raw.githubusercontent.com/reactive-tech/kubegres/v1.19/kubegres.yaml
