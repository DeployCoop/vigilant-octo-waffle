#!/usr/bin/env bash
source .env
source ./src/check_cmd.bash
check_cmd pwgen
KEY_FILE=./.${THIS_NAME}-plain-secrets.yaml
SECRET_FILE=./${THIS_SECRETS}.yaml 

phile_checkr () {
if [[ $# -eq 1 ]]; then
TARGET_FILE=$1
  if [[ -f $TARGET_FILE ]]; then
    echo "$TARGET_FILE exists, leaving untouched"; exit 0
  fi
else
  echo "Wrong number of args! $#"
  echo "usage: $0 file_to_check"
fi
}

if [[ ! $1 == '--force' ]]; then
  phile_checkr $SECRET_FILE
  phile_checkr $KEY_FILE
fi

liner () {
  echo "  $1 $2" >> $SECRET_FILE
  echo "  $1 $3" >> $KEY_FILE
}

munger () {
  if [[ $# -eq 0 ]]; then
      echo 'ERROR: no args!'; exit 1
  fi
  KEY_NAME=$1
  if [[ $# -eq 2 ]]; then
    SECRET=$2
  elif [[ $# -eq 3 ]]; then
    PASS_LENGTH=$2
    RANDO_METHOD=$3
    if [[ ${RANDO_METHOD} == 'tr' ]]; then
      check_cmd tr
      SECRET=$(< /dev/random tr -dc _A-Z-a-z-0-9 | head -c${PASS_LENGTH})
    elif [[ ${RANDO_METHOD} == 'pwgen' ]]; then
      SECRET=pwgen ${PASS_LENGTH} 1
    elif [[ ${RANDO_METHOD} == 'openssl' ]]; then
      check_cmd openssl
      SECRET=$(openssl rand -base64 ${PASS_LENGTH})
    else
      echo 'ERROR: unrecognized method!'; exit 1
    fi
  else
    PASS_LENGTH='23'
    SECRET=$(pwgen ${PASS_LENGTH} 1)
  fi
  based=$(echo -n ${SECRET} | base64)
  liner ${KEY_NAME} $based ${SECRET}
}


main () {
if [[ -f .env ]]; then
source .env
else
  echo ".env file does not exist, copy .env.example to .env and start there"
fi
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
cat << EOF > $KEY_FILE
apiVersion: v1
kind: Secret
metadata:
  name: ${THIS_SECRETS}
  namespace: ${THIS_NAME}
type: Opaque
stringData:
EOF
# munge the date
munger  "argocdadmin-password:" "31" "tr"
munger  "collabora-username:" "collabadmin"
munger "collabora-password:" 
munger "db-password:" 
munger "db-hostname:" "${THIS_NAME}nc-postgres:5432"
munger "db-name:" "${THIS_NAME}ncdb"
munger "db-username:" "${THIS_NAME}nc"
munger "db-admin-pass:" 
munger "nextcloud-username:" "ncadmin"
munger "nextcloud-password:" 
munger "nextcloud-token:" 
munger "redis-pass:" 
munger "replicationUserPassword:"
munger "smtp-username:" "mailadmin@${THIS_NAME}.com"
munger "smtp-password:" 
munger "smtp-host:" "mail.${THIS_NAME}.com"
munger "HARBOR_ADMIN_PASSWORD:" "31" "tr"
}

time main $@
