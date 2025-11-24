# config/production.yaml
manager:
  id: prod-manager-001
  name: Production XTM Manager
  execute_schedule: 10
  ping_alive_schedule: 60
  credentials_key_filepath: /keys/private_key_4096.pem
  logger:
    level: info
    format: json
    directory: true
    console: false

opencti:
  enable: true
  url: ${THIS_OPENCTI_PUBLIC_URL}
  token: ${OPENCTI_TOKEN}  # Reference env variable
  unsecured_certificate: false
  with_proxy: false
  logs_schedule: 10
  daemon:
    selector: kubernetes
    kubernetes:
      image_pull_policy: IfNotPresent

openbas:
  enable: false  # Coming Soon
