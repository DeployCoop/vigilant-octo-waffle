#!/usr/bin/env bash

THIS_THING=openproject

set -eu
source .env
source src/argoRunner.sh
set -x

argoRunner "$THIS_THING"
