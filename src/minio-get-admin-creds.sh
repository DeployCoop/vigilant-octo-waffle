#!/usr/bin/env bash
source src/sourceror.bash

secret_getter "${THIS_NAMESPACE}" ${THIS_NAME}-minio-env-configuration config.env
