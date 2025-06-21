#!/usr/bin/env bash
source src/util.bash
source src/sourceror.bash
secret_getter "${THIS_NAMESPACE}" "${THIS_OPENSEARCH_ADMIN_CRED_SECRET}" OPENSEARCH_INITIAL_ADMIN_PASSWORD
