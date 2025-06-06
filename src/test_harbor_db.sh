#!/usr/bin/env bash
# how long to sleep
: "${SLEEP_TIME:=3}"
# how many waits before giving up
: "${WAITS:=30}"
set -u
set -a && source .env && set +a

checkerrr () {
  countzero=0
  STILL_ERRORING=1
  while [[ $STILL_ERRORING -gt 0 ]]; do
    set +e
    kubectl exec -it -n "${THIS_NAMESPACE}" "goharbor-${THIS_NAME}-database-0" -c database -- /usr/bin/psql -d 'registry' -c "SELECT 1 FROM harbor_user where user_id = 1;"
    if [[ $? -eq 0 ]]; then
      if [[ $countzero -eq 0 ]]; then
        if [[ ${VERBOSITY} -gt 1 ]]; then
          printf "DB ready\n"
        fi
      else
        if [[ ${VERBOSITY} -gt 1 ]]; then
          printf "\nDB ready\n"
        fi
      fi
      STILL_ERRORING=0
      break
    else 
      if [[ $countzero -eq 0 ]]; then
        if [[ ${VERBOSITY} -gt 1 ]]; then
          echo -n 'db not ready waiting.'
        fi
      else
        if [[ ${VERBOSITY} -gt 1 ]]; then
          echo -n '.'
        fi
      fi
      if [[ $countzero -gt $WAITS ]]; then
        echo 'giving up check on harborDB'
        exit 1
      fi
      ((++countzero))
      sleep "$SLEEP_TIME"
    fi
    set -e
  done
}

checkerrr
sleep 3
