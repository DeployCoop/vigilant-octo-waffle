#!/usr/bin/env bash
# ==============================================================================
# src/k3s_fix_pause.sh - Fix Containerd Pause Image & Docker Hub Auth 400 Errors
# ==============================================================================
# Diagnoses and resolves 'FailedCreatePodSandBox: failed to pull image mirrored-pause
# failed to fetch oauth token: 400 Bad Request' on K3s nodes.
# ==============================================================================
set -euo pipefail

echo "============================================================"
echo "K3s Pod Sandbox & Pause Image Diagnostic / Repair"
echo "============================================================"

# 1. Check and clean /etc/rancher/k3s/registries.yaml
if [[ -f /etc/rancher/k3s/registries.yaml ]]; then
  echo "==> Inspecting /etc/rancher/k3s/registries.yaml..."
  if grep -qE 'auth:|username: ""|password: ""|\${' /etc/rancher/k3s/registries.yaml 2>/dev/null; then
    echo "  [WARN] Found empty or unexpanded auth credentials in registries.yaml!"
    echo "  [FIX] Backing up to /etc/rancher/k3s/registries.yaml.bak and sanitizing..."
    sudo cp /etc/rancher/k3s/registries.yaml /etc/rancher/k3s/registries.yaml.bak
    sudo tee /etc/rancher/k3s/registries.yaml << 'EOF'
mirrors:
  docker.io:
    endpoint:
      - "https://registry-1.docker.io"
EOF
    echo "  [OK] registries.yaml sanitized."
  else
    echo "  [OK] registries.yaml does not contain empty auth blocks."
  fi
else
  echo "==> /etc/rancher/k3s/registries.yaml not present."
fi

# 2. Check and clean /root/.docker/config.json
if [[ -f /root/.docker/config.json ]]; then
  echo "==> Inspecting /root/.docker/config.json..."
  if grep -qE '"auth":\s*""' /root/.docker/config.json 2>/dev/null; then
    echo "  [WARN] Found empty auth entry in /root/.docker/config.json!"
    sudo mv /root/.docker/config.json /root/.docker/config.json.bak
    echo "  [OK] /root/.docker/config.json backed up and removed."
  fi
fi

# 3. Clean containerd runtime cache if needed and restart K3s
echo "==> Restarting K3s service to reload clean containerd registry config..."
if systemctl is-active --quiet k3s 2>/dev/null; then
  sudo systemctl restart k3s
  echo "  [OK] Restarted k3s service."
elif systemctl is-active --quiet k3s-agent 2>/dev/null; then
  sudo systemctl restart k3s-agent
  echo "  [OK] Restarted k3s-agent service."
else
  echo "  [INFO] Neither k3s nor k3s-agent systemd service currently active."
fi

# 4. Pre-cache pause image directly from registry.k8s.io into containerd
echo "==> Pre-caching pause image from registry.k8s.io (bypasses Docker Hub entirely)..."
if command -v k3s >/dev/null 2>&1; then
  sudo k3s ctr -n k8s.io images pull registry.k8s.io/pause:3.10
  sudo k3s ctr -n k8s.io images tag registry.k8s.io/pause:3.10 docker.io/rancher/mirrored-pause:3.10.2
  echo "  [SUCCESS] Pre-cached docker.io/rancher/mirrored-pause:3.10.2 into containerd local storage."

  # Also configure permanent fallback in config.yaml.d
  sudo mkdir -p /etc/rancher/k3s/config.yaml.d
  sudo tee /etc/rancher/k3s/config.yaml.d/99-pause-image.yaml << 'EOF'
pause-image: "registry.k8s.io/pause:3.10"
EOF
  echo "  [OK] Permanent pause-image config set to registry.k8s.io/pause:3.10."
fi

echo "============================================================"
echo "Repair complete. Please verify with: kubectl get pods -A"
echo "============================================================"
