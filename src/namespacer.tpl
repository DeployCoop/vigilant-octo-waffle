apiVersion: v1
kind: Namespace
metadata:
  name: ${TARGET_NAMESPACE}
  labels:
    kubernetes.io/metadata.name: ${TARGET_NAMESPACE}
    pod-security.kubernetes.io/enforce: ${THIS_PSS_ENFORCE}
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: ${THIS_PSS_WARN}
    pod-security.kubernetes.io/warn-version: latest
    pod-security.kubernetes.io/audit: ${THIS_PSS_AUDIT}
    pod-security.kubernetes.io/audit-version: latest
    app.kubernetes.io/managed-by: vow
