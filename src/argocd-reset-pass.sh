#!/usr/bin/env bash
#source src/sourceror.bash

delete_keys () {
  kubectl patch secret -n argocd argocd-secret --type=json -p='[{"op": "remove", "path": "/data/admin.password"}]'
  kubectl patch secret -n argocd argocd-secret --type=json -p='[{"op": "remove", "path": "/data/admin.passwordMtime"}]'
  #kubectl patch secret argocd-secret -p '{"data": {"admin.password": null, "admin.passwordMtime": null}}' -n argocd
  kubectl rollout restart deployment argocd-server -n argocd
}

time delete_keys
