name: registry-proxy
services:
  docker-registry-proxy:
    container_name: docker_registry_proxy
    stdin_open: true
    tty: true
    networks:
      - kind
    hostname: docker-registry-proxy
    ports:
      - 0.0.0.0:3128:3128
    environment:
      - ENABLE_MANIFEST_CACHE=true
    volumes:
      - ${THIS_REG_DIR}/docker_mirror_cache:/docker_mirror_cache
      - ${THIS_REG_DIR}/docker_mirror_certs:/ca
    image: rpardini/docker-registry-proxy:0.6.5
networks:
  kind:
    external: true
    name: kind
