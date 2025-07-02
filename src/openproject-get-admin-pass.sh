#!/usr/bin/env bash
source src/sourceror.bash
secret_getter "${THIS_NAMESPACE}" "${THIS_OPENPROJECT_ADMIN_CRED_SECRET}" password
