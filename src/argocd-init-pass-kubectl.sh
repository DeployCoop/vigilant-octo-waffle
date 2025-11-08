#!/usr/bin/env bash
source src/sourceror.bash

xmain () {
  kubectl patch secret argocd-secret -p '{"data": {"admin.password": null, "admin.passwordMtime": null}}' -n argocd && \
  kubectl delete secret argocd-initial-admin-secret -n argocd && \
  kubectl rollout restart deployment argocd-server -n argocd
  src/wait_argo.sh
  kubectl get secret argocd-initial-admin-secret -n argocd -o jsonpath="{.data.password}" | base64 --decode
  echo ""
}

main () {
  if [[ ${VERBOSITY} -gt 99 ]]; then
    set -x
  fi
  set -u
  countzero=0
  result=1
  kubectl -n argocd patch secret argocd-secret \
    -p "{'stringData': {
      'admin.password': '${hash_pass}',
      'admin.passwordMtime': '$(date +%FT%T%Z)'
    }}"
}

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

delete_keys () {
  kubectl patch secret -n argocd argocd-secret --type=json -p='[{"op": "remove", "path": "/data/admin.password"}]'
  kubectl patch secret -n argocd argocd-secret --type=json -p='[{"op": "remove", "path": "/data/admin.passwordMtime"}]'
  #kubectl patch secret argocd-secret -p '{"data": {"admin.password": null, "admin.passwordMtime": null}}' -n argocd
  kubectl rollout restart deployment argocd-server -n argocd
}

admin_pass=$(yq '.data|."argocdadmin-password"' ${SECRET_FILE}|sed 's/"//g'|base64 -d)
admin_pass=${admin_pass//$'\n'/}
hash_pass=$(argocd account bcrypt --password ${admin_pass})
time delete_keys
