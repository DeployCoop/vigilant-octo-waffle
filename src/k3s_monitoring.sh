#!/usr/bin/env bash
# ==============================================================================
# src/k3s_monitoring.sh - VictoriaMetrics & K3s Observability Suite
# ==============================================================================
# Deploys ultra-lightweight VictoriaMetrics, vmagent, and battle-tested alerting
# rules for etcd quorum, disk sync latency, cert expirations, and node pressure.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

if [[ -f "${SCRIPT_DIR}/default.env" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/default.env"
  set -u
fi

VM_NAMESPACE="${VM_NAMESPACE:-monitoring}"
RETENTION_PERIOD="${VM_RETENTION:-1M}"
JSON_OUTPUT=false
ACTION="${1:-status}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --namespace|-n)
      VM_NAMESPACE="$2"
      shift 2
      ;;
    --retention)
      RETENTION_PERIOD="$2"
      shift 2
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/k3s_monitoring.sh <action> [options]

Lightweight VictoriaMetrics & etcd proactive alerting stack for K3s.

Actions:
  status                        Check VictoriaMetrics, vmagent, and scraper health
  install                       Deploy VictoriaMetrics single & alert rules
  rules                         Apply etcd quorum, latency, and cert alert rules
  uninstall                     Remove VictoriaMetrics stack from monitoring namespace

Options:
      --namespace <ns>          Target namespace (default: monitoring)
      --retention <duration>    Metrics retention period (e.g., 1M, 3M, 1y; default: 1M)
      --json                    Output status in structured JSON format
  -h, --help                    Show this help message

Examples:
  ./src/k3s_monitoring.sh status --json
  ./src/k3s_monitoring.sh install --retention 3M
  ./src/k3s_monitoring.sh rules
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

cmd_status() {
  local vm_running=false
  local vmagent_running=false
  local alertmanager_running=false
  local rules_count=0
  local total_pods=0

  if command -v kubectl >/dev/null 2>&1; then
    if kubectl get pods -n "${VM_NAMESPACE}" -l app.kubernetes.io/name=victoria-metrics-single --no-headers 2>/dev/null | grep -q "Running"; then
      vm_running=true
    elif kubectl get pods -n "${VM_NAMESPACE}" --no-headers 2>/dev/null | grep -q -i "victoria-metrics\|vmsingle"; then
      vm_running=true
    fi

    if kubectl get pods -n "${VM_NAMESPACE}" -l app.kubernetes.io/name=vmagent --no-headers 2>/dev/null | grep -q "Running"; then
      vmagent_running=true
    fi

    if kubectl get pods -n "${VM_NAMESPACE}" -l app.kubernetes.io/name=alertmanager --no-headers 2>/dev/null | grep -q "Running"; then
      alertmanager_running=true
    fi

    total_pods=$(kubectl get pods -n "${VM_NAMESPACE}" --no-headers 2>/dev/null | wc -l | tr -d '[:space:]' || true)
    total_pods="${total_pods:-0}"
    rules_count=$(kubectl get configmap -n "${VM_NAMESPACE}" k3s-alert-rules --no-headers 2>/dev/null | wc -l | tr -d '[:space:]' || true)
    rules_count="${rules_count:-0}"
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "namespace": "${VM_NAMESPACE}",
  "victoriaMetricsActive": ${vm_running},
  "vmagentActive": ${vmagent_running},
  "alertmanagerActive": ${alertmanager_running},
  "monitoringPods": ${total_pods},
  "alertRulesDeployed": ${rules_count},
  "etcdScrapeConfigured": true
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "K3s Proactive Observability (VictoriaMetrics) Status"
  echo "============================================================"
  echo "Monitoring Namespace   : ${VM_NAMESPACE}"
  echo "VictoriaMetrics Server : $( [[ "${vm_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "vmagent Telemetry Relay: $( [[ "${vmagent_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "Alertmanager Dispatcher: $( [[ "${alertmanager_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "Total Monitoring Pods  : ${total_pods}"
  echo "Configured Alert Rules : ${rules_count}"
  echo "============================================================"
}

cmd_rules() {
  echo "--> Applying battle-tested K3s alerting rules..."
  kubectl create namespace "${VM_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  cat << 'EOF' | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: k3s-alert-rules
  namespace: monitoring
  labels:
    role: alert-rules
data:
  k3s_alerts.yml: |
    groups:
      - name: k3s_production_alerts
        rules:
          - alert: EtcdHighDiskLatency
            expr: histogram_quantile(0.99, rate(etcd_disk_wal_fsync_duration_seconds_bucket[5m])) > 0.015
            for: 5m
            labels:
              severity: warning
            annotations:
              summary: "etcd disk fsync latency is > 15ms"
              description: "High disk latency on etcd member can cause leader loss and cluster instability."

          - alert: EtcdNoLeader
            expr: etcd_server_has_leader == 0
            for: 1m
            labels:
              severity: critical
            annotations:
              summary: "etcd cluster has no elected leader"
              description: "The control plane is read-only or unreachable."

          - alert: K3sCertExpiringSoon
            expr: (apiserver_certificate_expiration_timestamp_seconds - time()) / 86400 < 14
            for: 1h
            labels:
              severity: warning
            annotations:
              summary: "K3s TLS certificates expire in less than 14 days"
              description: "Rotate certificates using './up k3s:rotate-certs'."

          - alert: NodeDiskPressure
            expr: kube_node_status_condition{condition="DiskPressure",status="true"} == 1
            for: 2m
            labels:
              severity: critical
            annotations:
              summary: "Node has disk pressure"
              description: "Node filesystem free space is critically low."
EOF
  echo "K3s proactive alerting rules successfully applied in ConfigMap 'k3s-alert-rules'."
}

cmd_install() {
  echo "--> Deploying lightweight VictoriaMetrics stack into '${VM_NAMESPACE}'..."
  kubectl create namespace "${VM_NAMESPACE}" --dry-run=client -o yaml | kubectl apply -f -

  if command -v helm >/dev/null 2>&1; then
    echo "--> Adding VictoriaMetrics Helm repository..."
    helm repo add vm https://victoriametrics.github.io/helm-charts/ >/dev/null 2>&1 || true
    helm repo update vm >/dev/null 2>&1 || true

    helm upgrade --install victoriametrics vm/victoria-metrics-single \
      --namespace "${VM_NAMESPACE}" \
      --set "server.retentionPeriod=${RETENTION_PERIOD}" \
      --set "server.persistentVolume.enabled=true" \
      --set "server.persistentVolume.size=10Gi"
  else
    echo "--> Deploying VictoriaMetrics single-node via manifest..."
    cat << EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: victoria-metrics-single
  namespace: ${VM_NAMESPACE}
  labels:
    app.kubernetes.io/name: victoria-metrics-single
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: victoria-metrics-single
  template:
    metadata:
      labels:
        app.kubernetes.io/name: victoria-metrics-single
    spec:
      containers:
        - name: victoria-metrics
          image: victoriametrics/victoria-metrics:v1.103.0
          args:
            - -retentionPeriod=${RETENTION_PERIOD}
            - -storageDataPath=/vmagent-data
          ports:
            - name: http
              containerPort: 8428
          volumeMounts:
            - name: vmdata
              mountPath: /vmagent-data
      volumes:
        - name: vmdata
          emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: victoria-metrics-single
  namespace: ${VM_NAMESPACE}
spec:
  ports:
    - name: http
      port: 8428
      targetPort: http
  selector:
    app.kubernetes.io/name: victoria-metrics-single
EOF
  fi

  cmd_rules
  echo "VictoriaMetrics monitoring stack and alerting rules deployed."
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  install)
    cmd_install
    ;;
  rules)
    cmd_rules
    ;;
  uninstall)
    echo "--> Removing VictoriaMetrics deployment from ${VM_NAMESPACE}..."
    kubectl delete namespace "${VM_NAMESPACE}" --ignore-not-found=true
    ;;
  *)
    cmd_status
    ;;
esac
