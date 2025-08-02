#!/usr/bin/env bash
source src/sourceror.bash

#secret_getter "${THIS_NAMESPACE}" ${THIS_NAME}-minio-env-configuration config.env
kubectl get secret -n bokbot bokbot-minio-env-configuration -o json|jq '.data."config.env"'|sed 's/"//g'|base64 -d
