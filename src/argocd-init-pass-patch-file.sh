#!/usr/bin/env bash
source src/sourceror.bash

patch_file () {
  NAMESPACE="argocd"
  PATCH_FILE=$(mktemp)

# break indent
cat <<EOF > "$PATCH_FILE"
stringData:
  admin.password: "${hash_pass}"
  admin.passwordMtime: "$(date +%FT%T%Z)"
EOF
# unbreak indent

  kubectl -n argocd patch secret argocd-secret \
    --namespace "$NAMESPACE" \
    --patch-file "$PATCH_FILE"

  rm "$PATCH_FILE"
}

admin_pass=$(kubectl get secret -n example example-secrets -o json|jq -r '.data."argocdadmin-password"'|base64 -d)
hash_pass=$(argocd account bcrypt --password ${admin_pass})

time patch_file

