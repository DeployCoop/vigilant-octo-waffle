controller:
  tcp:
    configMap: "ingress-nginx/tcp-services-configmap"
  extraArgs:
    tcp-services-configmap: "ingress-nginx/tcp-services-configmap"
  service:
    enabled: true
    external:
      enabled: true
    type: LoadBalancer
    enableHttp: true
    enableHttps: true
    ports:
      http: 80
      https: 443
      mqtt: 1883
