---
apiVersion: k3d.io/v1alpha5 # this will change in the future as we make everything more stable
kind: Simple # internally, we also have a Cluster config, which is not yet available externally
metadata:
  name: vigilant-octo-waffle # name that you want to give to your cluster (will still be prefixed with `k3d-`)
#servers: 3 # same as `--servers 3`
#agents: 1 # same as `--agents 4`
servers: ${THIS_K3D_SERVERS_NUM}
agents: ${THIS_K3D_AGENTS_NUM}
volumes: # repeatable flags are represented as YAML lists
  - volume: ${THIS_STORAGE_PATH}/workerk3d:/mnt/xfs_backup/example
    nodeFilters:
      - server:0
      - agent:*
  - volume: ${THIS_STORAGE_PATH}/rancher:/var/lib/rook
    nodeFilters:
      - server:0
      - agent:*
  - volume: ${THIS_STORAGE_PATH}/udev:/run/udev
    nodeFilters:
      - server:*
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
    name: docker-io # name of the registry container
    host: "0.0.0.0"
    hostPort: "5000"
    proxy: # omit this to have a "normal" registry, set this to create a registry proxy (pull-through cache)
      remoteURL: https://registry-1.docker.io # proxy DockerHub
      username: "" # unauthenticated
      password: "" # unauthenticated
    volumes:
      - ${THIS_REG_DIR}:/var/lib/registry # persist registry data locally
  config: | # tell K3s to use this registry when pulling from DockerHub
    mirrors:
      "docker.io":
        endpoint:
          - http://docker-io:5000
options:
  k3d: # k3d runtime settings
    wait: true # wait for cluster to be usable before returining; same as `--wait` (default: true)
    timeout: "90s" # wait timeout before aborting; same as `--timeout 60s`
  k3s: # options passed on to K3s itself
    extraArgs: # additional arguments passed to the `k3s server|agent` command; same as `--k3s-arg`
      - arg: --disable=traefik
        nodeFilters:
          - server:*
