#!/usr/bin/env bash
THIS_THING=openproject
set -e
source ./src/util.bash
check_enabler

source src/argoRunner.sh
argoRunner "$THIS_THING"
