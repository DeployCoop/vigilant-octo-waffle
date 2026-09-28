#!/usr/bin/env bash
THIS_CWD=$(pwd)
TMP=$(mktemp)
trap "rm ${TMP}" EXIT
TARGETS=$(shuf targets)
set -eu

mkdir -pv /etc/rancher/k3s
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  envsubst '${TARGET}' < makr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}

echo '' > ${TMP}
cp -av "${THIS_CWD}/registries.yaml" /etc/rancher/k3s/registries.yaml
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  envsubst '${TARGET}' < registr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}

echo '' > ${TMP}
for TARGET in ${TARGETS}; do
  export TARGET=${TARGET}
  envsubst '${TARGET}' < k3sr.tpl >> $TMP
done
cat $TMP
parallel -j 99 -- < ${TMP}
