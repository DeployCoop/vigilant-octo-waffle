---
apiVersion: k3d.io/v1alpha5 # this will change in the future as we make everything more stable
kind: Simple # internally, we also have a Cluster config, which is not yet available externally
metadata:
  name: vigilant-octo-waffle # name that you want to give to your cluster (will still be prefixed with `k3d-`)
servers: 3 # same as `--servers 3`
agents: 3 # same as `--agents 3`
volumes: # repeatable flags are represented as YAML lists
  - volume: ${THIS_STORAGE_PATH}/workerk3d:/mnt/xfs_backup/example
    nodeFilters:
      - server:0
      - agent:*
ports:
  - port: 8000:8000 # same as `--port '8080:8000@loadbalancer'`
    nodeFilters:
      - loadbalancer
  - port: 443:443 # same as `--port '443:443@loadbalancer'`
    nodeFilters:
      - loadbalancer
  - port: 80:80 # same as `--port '80:80@loadbalancer'`
    nodeFilters:
      - loadbalancer
registries: # define how registries should be created or used
  create: # creates a default registry to be used with the cluster; same as `--registry-create registry.localhost`
    name: registry.localhost
    host: "0.0.0.0"
    hostPort: "5000"
    proxy: # omit this to have a "normal" registry, set this to create a registry proxy (pull-through cache)
      remoteURL: https://registry-1.docker.io # mirror the DockerHub registry
      username: "" # unauthenticated
      password: "" # unauthenticated
    volumes:
      - ${THIS_REG_DIR}:/var/lib/registry # persist registry data locally
options:
  k3d: # k3d runtime settings
    wait: true # wait for cluster to be usable before returning; same as `--wait` (default: true)
    timeout: "90s" # wait timeout before aborting; same as `--timeout 60s`
