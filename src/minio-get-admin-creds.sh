#!/usr/bin/env bash
source src/sourceror.bash

TARGET_NS="${THIS_NAMESPACE:-${THIS_NAME:-minio}}"
kubectl get secret -n "${TARGET_NS}" "${TARGET_NS}-minio-env-configuration" -o json|jq '.data."config.env"'|sed 's/"//g'|base64 -d
