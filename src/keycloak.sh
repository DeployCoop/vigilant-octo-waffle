#!/usr/bin/env bash
kubectl create namespace keycloak
kubectl create -f https://raw.githubusercontent.com/keycloak/keycloak-quickstarts/refs/heads/main/kubernetes/keycloak.yaml
