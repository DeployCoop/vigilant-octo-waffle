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

# 4. Attempt pulling pause image via k3s crictl
echo "==> Testing pause image pull via containerd (k3s crictl)..."
if command -v k3s >/dev/null 2>&1; then
  if sudo k3s crictl pull rancher/mirrored-pause:3.10.2; then
    echo "  [SUCCESS] Successfully pulled rancher/mirrored-pause:3.10.2!"
  else
    echo "  [WARN] Docker Hub pull still failing. Applying fallback to registry.k8s.io/pause:3.10..."
    sudo mkdir -p /etc/rancher/k3s/config.yaml.d
    sudo tee /etc/rancher/k3s/config.yaml.d/99-pause-image.yaml << 'EOF'
pause-image: "registry.k8s.io/pause:3.10"
EOF
    echo "  [OK] Configured pause-image to registry.k8s.io/pause:3.10"
    if systemctl is-active --quiet k3s 2>/dev/null; then
      sudo systemctl restart k3s
    elif systemctl is-active --quiet k3s-agent 2>/dev/null; then
      sudo systemctl restart k3s-agent
    fi
    sudo k3s crictl pull registry.k8s.io/pause:3.10
    echo "  [SUCCESS] Successfully pulled fallback pause image from registry.k8s.io!"
  fi
fi

echo "============================================================"
echo "Repair complete. Please verify with: kubectl get pods -A"
echo "============================================================"
