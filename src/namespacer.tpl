apiVersion: v1
kind: Namespace
metadata:
  labels:
    kubernetes.io/metadata.name: ${TARGET_NAMESPACE}
  name: ${TARGET_NAMESPACE}
