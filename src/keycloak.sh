#!/usr/bin/env bash
THIS_THING=keycloak
source src/common.sh

initializer "$this_cwd/init/keycloak"
w8_all_namespace "${THIS_NAMESPACE}" 
