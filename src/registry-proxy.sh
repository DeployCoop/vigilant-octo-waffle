#!/bin/bash
. .env

registry_from_template () {
  TMP=$(mktemp -d)
  envsubst < "src/registry-proxy/docker-compose.yml.tpl" > "${TMP}/docker-compose.yml"
  cd "${TMP}"
  #docker-compose down
  docker-compose up -d
}


configr () {
KIND_NAME=vigilant-octo-waffle
SETUP_URL=http://docker-registry-proxy:3128/setup/systemd
pids=""
for NODE in $(kind get nodes --name "$KIND_NAME"); do
  docker exec "$NODE" sh -c "\
      curl $SETUP_URL \
      | sed s/docker\.service/containerd\.service/g \
      | sed '/Environment/ s/$/ \"NO_PROXY=gcr.io,127.0.0.0\/8,10.0.0.0\/8,172.16.0.0\/12,192.168.0.0\/16\"/' \
      | bash"
done
}

orig_config_deprecated () {
# original from https://github.com/rpardini/docker-registry-proxy#kind-cluster
KIND_NAME=vigilant-octo-waffle
SETUP_URL=http://docker-registry-proxy:3128/setup/systemd
pids=""
for NODE in $(kind get nodes --name "$KIND_NAME"); do
  docker exec "$NODE" sh -c "\
      curl $SETUP_URL \
      | sed s/docker\.service/containerd\.service/g \
      | sed '/Environment/ s/$/ \"NO_PROXY=127.0.0.0\/8,10.0.0.0\/8,172.16.0.0\/12,192.168.0.0\/16\"/' \
      | bash" & pids="$pids $!" # Configure every node in background
done
wait "$pids" # Wait for all configurations to end
}

orig_run_deprecated () {
if [[ -f ${reg_cid} ]]; then
  docker stop "$(cat ${reg_cid})"
  #docker rm   "$(cat ${reg_cid})"
  rm ${reg_cid}
fi
reg_cid=${THIS_REG_DIR}/registry.cid
composerize docker run \
  --rm \
  --name docker_registry_proxy \
  -it \
  -d \
  --cidfile "${reg_cid}" \
  --net kind \
  --hostname docker-registry-proxy \
  -p 0.0.0.0:3128:3128 \
  -e ENABLE_MANIFEST_CACHE=true \
  -v ${THIS_REG_DIR}/docker_mirror_cache:/docker_mirror_cache \
  -v ${THIS_REG_DIR}/docker_mirror_certs:/ca \
  rpardini/docker-registry-proxy:0.6.5
}

set -eux
registry_from_template
sleep 5
configr

exit 0
