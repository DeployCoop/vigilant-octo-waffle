#!/usr/bin/env bash
source src/sourceror.bash
if [[ ${VERBOSITY} -gt 99 ]]; then
  set -x
fi
secret_getter "${THIS_NAMESPACE}" "${THIS_OPENPROJECT_ADMIN_CRED_SECRET}" password
