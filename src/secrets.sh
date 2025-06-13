#!/usr/bin/env bash
source src/sourceror.bash
source src/util.bash

if [[ ${THIS_ENABLE_PLAIN_SECRETS_FILE} == 'true' ]]; then
  KEY_FILE=./.${THIS_NAME}-plain-secrets.yaml
fi
SECRET_FILE=./${THIS_SECRETS}.yaml 

if [[ ! $1 == '--force' ]]; then
  phile_checkr $SECRET_FILE
  if [[ ${THIS_ENABLE_PLAIN_SECRETS_FILE} == 'true' ]]; then
    phile_checkr $KEY_FILE
  fi
fi

main () {
# make the headers
cat << EOF > $SECRET_FILE
apiVersion: v1
kind: Secret
metadata:
  name: ${THIS_SECRETS}
  namespace: ${THIS_NAME}
type: Opaque
data:
EOF
if [[ ${THIS_ENABLE_PLAIN_SECRETS_FILE} == 'true' ]]; then
cat << EOF > $KEY_FILE
apiVersion: v1
kind: Secret
metadata:
  name: ${THIS_SECRETS}
  namespace: ${THIS_NAME}
type: Opaque
stringData:
EOF
fi
# munge the date
munger "argocdadmin-password:" "31" "tr"
munger "collabora-username:" "collabadmin"
munger "collabora-password:" 
munger "db-admin-pass:" 
munger "nc-db-password:" 
munger "nc-db-hostname:" "${THIS_NAME}-postgres:5432"
munger "nc-db-name:" "${THIS_NAME}ncdb"
munger "nc-db-username:" "${THIS_NAME}nc"
munger "nextcloud-username:" "ncadmin"
munger "nextcloud-password:" 
munger "nextcloud-token:" 
munger "op-db-password:" 
munger "redis-pass:" 
munger "replicationUserPassword:"
munger "smtp-username:" "mailadmin@${THIS_NAME}.com"
munger "smtp-password:" 
munger "smtp-host:" "mail.${THIS_NAME}.com"
munger "HARBOR_ADMIN_PASSWORD:" "12" "openssl"
munger "OPENSEARCH_INITIAL_ADMIN_PASSWORD:" "23" "tr"
}

time main $@
