#!/usr/bin/env bash
THIS_THING=openproject
source src/common.sh

secret_maker "${THIS_OPENPROJECT_ADMIN_CRED_SECRET}" "${THIS_OPENPROJECT_ADMIN_USER}" "${THIS_OPENPROJECT_ADMIN_PASSWORD}"
db_password=$(kubectl get secret -n "${THIS_NAMESPACE}" example-secrets -o json|jq -r '.data."op-db-password"'|base64 -d)
src/mkdb.sh "${THIS_OPENPROJECT_POSTGRES_DB}" "${THIS_OPENPROJECT_POSTGRES_USER}" "${db_password}"
argoRunner "$THIS_THING"
