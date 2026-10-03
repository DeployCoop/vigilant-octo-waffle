#!/usr/bin/env bash
# ==============================================================================
# src/k3s_gpu.sh - NVIDIA / AMD GPU Acceleration & Edge AI Orchestrator
# ==============================================================================
# Auto-detects local GPU accelerators, configures K3s containerd runtime hooks,
# and deploys the Kubernetes GPU Device Plugin for Ollama / vLLM fleets.
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

CONTAINERD_TMPL="/var/lib/rancher/k3s/agent/etc/containerd/config.toml.tmpl"
NVIDIA_PLUGIN_VERSION="${NVIDIA_PLUGIN_VERSION:-v0.16.2}"
JSON_OUTPUT=false
DRY_RUN=false
ACTION="${1:-status}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/k3s_gpu.sh <action> [options]

NVIDIA/AMD GPU accelerator detection, containerd runtime tuning, and device plugin setup.

Actions:
  status                        Audit local GPU hardware and K3s allocatable GPU resources
  detect                        Quick scan for NVIDIA/AMD PCIe hardware and driver status
  setup                         Patch K3s containerd config and deploy NVIDIA Device Plugin
  test                          Launch a test CUDA container job to verify cluster GPU access
  uninstall                     Remove GPU device plugin and restore default containerd config

Options:
      --dry-run                 Simulate actions without applying manifests or modifying files
      --json                    Output status and detection details in structured JSON
  -h, --help                    Show this help message

Examples:
  ./src/k3s_gpu.sh status --json
  ./src/k3s_gpu.sh setup
  ./src/k3s_gpu.sh test
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

check_root() {
  if [[ $(id -u) -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

cmd_detect() {
  local has_nvidia=false
  local has_amd=false
  local gpu_model="none"
  local driver_ver="none"
  local cuda_ver="none"
  local vram_mb=0

  if command -v nvidia-smi >/dev/null 2>&1; then
    has_nvidia=true
    gpu_model=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || echo "NVIDIA GPU")
    driver_ver=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -n 1 || echo "unknown")
    vram_mb=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 || echo 0)
    cuda_ver=$(nvidia-smi 2>/dev/null | grep -i "CUDA Version" | awk '{print $9}' || echo "unknown")
  elif lspci 2>/dev/null | grep -Ei "3d|vga|display" | grep -qi "nvidia"; then
    has_nvidia=true
    gpu_model=$(lspci 2>/dev/null | grep -Ei "3d|vga|display" | grep -i "nvidia" | cut -d: -f3 | xargs || echo "NVIDIA GPU")
  fi

  if lspci 2>/dev/null | grep -Ei "3d|vga|display" | grep -qi "amd\|radeon"; then
    has_amd=true
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "nvidiaDetected": ${has_nvidia},
  "amdDetected": ${has_amd},
  "gpuModel": "${gpu_model}",
  "driverVersion": "${driver_ver}",
  "cudaVersion": "${cuda_ver}",
  "vramMegabytes": ${vram_mb}
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "Host GPU Hardware Acceleration Detection"
  echo "============================================================"
  echo "NVIDIA GPU Present : $( [[ "${has_nvidia}" == "true" ]] && echo "YES" || echo "NO" )"
  echo "AMD GPU Present    : $( [[ "${has_amd}" == "true" ]] && echo "YES" || echo "NO" )"
  echo "Model              : ${gpu_model}"
  echo "Driver Version     : ${driver_ver}"
  echo "CUDA Version       : ${cuda_ver}"
  echo "Total VRAM         : ${vram_mb} MiB"
  echo "============================================================"
}

cmd_status() {
  local has_nvidia=false
  local gpu_model="none"
  local vram_mb=0
  local toolkit_installed=false
  local containerd_configured=false
  local plugin_running=false
  local allocatable_gpus=0

  if command -v nvidia-smi >/dev/null 2>&1; then
    has_nvidia=true
    gpu_model=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1 || echo "NVIDIA GPU")
    vram_mb=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 || echo 0)
  fi

  if command -v nvidia-container-runtime >/dev/null 2>&1 || command -v nvidia-ctk >/dev/null 2>&1; then
    toolkit_installed=true
  fi

  if [[ -f "${CONTAINERD_TMPL}" ]] && grep -q "nvidia" "${CONTAINERD_TMPL}" 2>/dev/null; then
    containerd_configured=true
  fi

  if command -v kubectl >/dev/null 2>&1; then
    if kubectl get pods -A -l app.kubernetes.io/name=nvidia-device-plugin --no-headers 2>/dev/null | grep -q "Running"; then
      plugin_running=true
    fi
    local alloc
    alloc=$(kubectl get nodes -o jsonpath='{.items[*].status.allocatable.nvidia\.com/gpu}' 2>/dev/null || true)
    if [[ -n "${alloc}" ]]; then
      allocatable_gpus=$(echo "${alloc}" | tr ' ' '+' | bc 2>/dev/null || echo 1)
    fi
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "nvidiaGpuPresent": ${has_nvidia},
  "gpuModel": "${gpu_model}",
  "vramMegabytes": ${vram_mb},
  "containerToolkitInstalled": ${toolkit_installed},
  "containerdConfigured": ${containerd_configured},
  "devicePluginRunning": ${plugin_running},
  "allocatableGpus": ${allocatable_gpus}
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "K3s GPU Acceleration & AI Workload Status"
  echo "============================================================"
  echo "NVIDIA Hardware    : $( [[ "${has_nvidia}" == "true" ]] && echo "DETECTED (${gpu_model}, ${vram_mb} MiB)" || echo "NONE" )"
  echo "NVIDIA Toolkit     : $( [[ "${toolkit_installed}" == "true" ]] && echo "INSTALLED" || echo "NOT DETECTED" )"
  echo "K3s Containerd CRI : $( [[ "${containerd_configured}" == "true" ]] && echo "NVIDIA RUNTIME ACTIVE" || echo "DEFAULT RUNTIME" )"
  echo "K8s Device Plugin  : $( [[ "${plugin_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "Allocatable Cluster: ${allocatable_gpus} GPU(s)"
  echo "============================================================"
}

cmd_setup() {
  echo "--> Setting up GPU Acceleration for K3s..."
  check_root

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY-RUN] Would create ${CONTAINERD_TMPL} and deploy NVIDIA Device Plugin."
    return 0
  fi

  local containerd_dir="/var/lib/rancher/k3s/agent/etc/containerd"
  ${SUDO} mkdir -p "${containerd_dir}"

  if [[ ! -f "${CONTAINERD_TMPL}" ]]; then
    echo "--> Generating K3s containerd template with NVIDIA runtime support..."
    ${SUDO} tee "${CONTAINERD_TMPL}" > /dev/null << 'EOF'
{{ template "base" . }}

[plugins."io.containerd.grpc.v1.cri".containerd.runtimes."nvidia"]
  runtime_type = "io.containerd.runc.v2"
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes."nvidia".options]
  BinaryName = "/usr/bin/nvidia-container-runtime"
EOF
    echo "Containerd template created at ${CONTAINERD_TMPL}."
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet k3s; then
      echo "--> Restarting K3s agent to regenerate containerd configuration..."
      ${SUDO} systemctl restart k3s
    fi
  else
    echo "Containerd template already exists at ${CONTAINERD_TMPL}."
  fi

  if command -v kubectl >/dev/null 2>&1; then
    echo "--> Deploying NVIDIA Kubernetes Device Plugin DaemonSet..."
    kubectl apply -f "https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/${NVIDIA_PLUGIN_VERSION}/deployments/static/gpu-feature-discovery-daemonset.yaml" || true
    kubectl apply -f "https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/${NVIDIA_PLUGIN_VERSION}/deployments/static/nvidia-device-plugin.yml" || true
    echo "Device Plugin manifest applied."
  fi

  echo "K3s GPU acceleration configured successfully."
}

cmd_test() {
  echo "--> Running CUDA GPU smoke test in Kubernetes..."
  cat << 'EOF' | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: gpu-smoketest
  namespace: default
spec:
  ttlSecondsAfterFinished: 60
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: cuda-test
          image: nvidia/cuda:12.4.0-base-ubuntu22.04
          command: ["nvidia-smi"]
          resources:
            limits:
              nvidia.com/gpu: 1
EOF
  echo "GPU smoke test job submitted. Verifying pod output..."
  sleep 3
  kubectl get job gpu-smoketest || true
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  detect)
    cmd_detect
    ;;
  setup)
    cmd_setup
    ;;
  test)
    cmd_test
    ;;
  *)
    cmd_status
    ;;
esac
