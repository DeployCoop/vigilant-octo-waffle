#!/usr/bin/env bash
set -eu
source ./src/sourceror.bash
TMP=$(mktemp -d)
cleanup () {
  if [[ ${VERBOSITY} -gt 10 ]]; then
    rm -Rvf ${TMP}
  else
    rm -Rf ${TMP}
  fi
}
trap cleanup EXIT

sqlrrr () {
  kubectl get secret -n "${THIS_NAMESPACE}" example-secrets -o json|jq -r '.data."db-admin-pass"'|base64 -d 1> "${TMP}/pass"
  db_admin_password=$(cat ${TMP}/pass)
  THIS_CMD=$1
  #UPDATE_CMD="PGPASSWORD=${db_admin_password} /usr/bin/psql -u postgres -d "${POSTGRES_DB}" -c \"${THIS_CMD}\""
  #UPDATE_CMD="psql -U 'postgres' -c \"${THIS_CMD}\""
  #UPDATE_CMD="psql -U postgres postgresql://postgres:ahGi7vae6ahThahQu6ogh2p@localhost/postgres -c \"${THIS_CMD}\""
  UPDATE_CMD="psql 'postgresql://postgres:${db_admin_password}@localhost/postgres' -c \"${THIS_CMD}\""
  echo kubectl exec -n "${THIS_NAMESPACE}" "${THIS_NAME}-postgres-1-0" -c "${THIS_NAME}-postgres-1" -- "${UPDATE_CMD}" | bash
}

make_db () {
  customDatabaseName="$1"
  customUserName="$2"
  customPassword="$3"
  sqlrrr "CREATE DATABASE $customDatabaseName;"
  sqlrrr "CREATE USER $customUserName WITH PASSWORD '$customPassword';"
  sqlrrr "GRANT ALL PRIVILEGES ON DATABASE $customDatabaseName to $customUserName;"
  sqlrrr "ALTER DATABASE $customDatabaseName SET bytea_output = 'escape';"
}

if [[ $# -eq 3 ]]; then
  make_db "$@"
else
  echo 'useage:'
  echo $0 customDatabaseName customUserName customPassword
fi
#cleanup
