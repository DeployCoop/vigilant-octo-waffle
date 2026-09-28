mirrors:
  "*":
    endpoint:
      - "https://registry-1.docker.io"
configs:
  "docker.io":
    auth:
      username: "${DOCKER_USERNAME:-}"
      password: "${DOCKER_PASSWORD:-}"
