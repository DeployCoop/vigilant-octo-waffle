#!/usr/bin/env bash
source src/sourceror.bash

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -u

  echo "Waiting for argocd-secret to be created..."
  until kubectl -n argocd get secret argocd-secret > /dev/null 2>&1; do
    sleep 2
  done
  echo "argocd-secret found."

  admin_pass=$(kubectl get secret -n ${THIS_NAME} ${THIS_NAME}-secrets -o json|jq -r '.data."argocdadmin-password"'|base64 -d)

  echo "Generating bcrypt hash for the admin password..."
  bcrypt_hash=$(htpasswd -nbBC 10 "" "$admin_pass" | tr -d ':\n' | sed 's/\$2y/\$2a/')
  mtime=$(date -u +%FT%TZ)

  patch_json=$(jq -n \
    --arg hash "$bcrypt_hash" \
    --arg mtime "$mtime" \
    '{stringData: {"admin.password": $hash, "admin.passwordMtime": $mtime}}')

  echo "Patching argocd-secret with the new password..."
  kubectl -n argocd patch secret argocd-secret \
    --type merge \
    --patch "$patch_json"

  echo "Restarting argocd-server to apply the new password and clear any login locks..."
  kubectl -n argocd rollout restart deployment argocd-server

  echo "Waiting for argocd-server to be ready..."
  kubectl -n argocd wait --for=condition=ready pod -l app.kubernetes.io/name=argocd-server --timeout=120s

  echo "Password has been updated successfully."
  echo "You can now log in with the password from your secrets file."
}

time main
