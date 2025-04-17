#!/usr/bin/env bash

# Check if a command exists
check_cmd () {
  if ! type "$1" > /dev/null; then
    echo "$1 was not found in your path!"
    echo "To proceed please install $1 to your path and try again!"
    exit 1
  fi
}
#useage
#check_cmd argocd
