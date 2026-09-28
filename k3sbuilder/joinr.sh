#!/usr/bin/env bash
: "${PARALLEL_JOINS:=1}"
THIS_CWD=$(pwd)
JOIN_TMP=$(mktemp)
JOINR_TMP=$(mktemp)
trap "rm ${JOIN_TMP} ${JOINR_TMP}" EXIT
MASTER_IP=$(tail -n1 .master_ip)
TARGETS=$(shuf targets)
set -eu

. ./vigilant-octo-waffle/.secrets/k3s_env

echo 'joining the other hosts'
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  export MASTER_IP=${MASTER_IP}
  envsubst '${TARGET} ${MASTER_IP}' < join.tpl > $JOIN_TMP
  scp $JOIN_TMP root@${TARGET}:/root/join.sh
  ssh root@${TARGET} 'chmod +x /root/join.sh'
  envsubst '${TARGET} ${MASTER_IP}' < joinr.tpl >> $JOINR_TMP
done
cat $JOINR_TMP
#exit 0
if [[ ${PARALLEL_JOINS} -gt 1 ]]; then
  parallel -j ${PARALLEL_JOINS} -- < ${JOINR_TMP}
else
  bash ${JOINR_TMP}
fi
