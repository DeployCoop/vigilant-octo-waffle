#!/usr/bin/env bash
# how long to sleep
: "${SLEEP_TIME:=3}"
# how many waits before giving up
: "${WAITS:=5}"
set -eu
set -a && source .env && set +a

checkerrr () {
  countzero=0
  STILL_ERRORING=1
  while [[ $STILL_ERRORING -gt 0 ]]; do
    kubectl exec -it -n "${THIS_NAMESPACE}" "goharbor-${THIS_NAME}-database-0" -c database -- /usr/bin/psql -d 'registry' -c "SELECT 1 FROM harbor_user where user_id = 1;"
    if [[ $? -eq 0 ]]; then
      if [[ $countzero -eq 0 ]]; then
        printf "DB ready\n"
      else
        printf "\nDB ready\n"
      fi
      STILL_ERRORING=0
      break
    else 
      if [[ $countzero -eq 0 ]]; then
        echo -n 'db not ready waiting.'
      else
        echo -n '.'
      fi
      if [[ $countzero -gt $WAITS ]]; then
        echo 'giving up check on harborDB'
        exit 1
      fi
      ((countzero++))
      sleep "$SLEEP_TIME"
    fi
  done
}

checkerrr
