#!/usr/bin/env bash
: ${DEBUG:=false}
linerrr () {
  if [[ ! $# -eq 2 ]]; then
    echo "wrong args $#"
    echo "useage:"
    echo "$0 line_to_add file_to_add_to"
    exit 1
  fi
  line_to_add=$1
  file_to_add_to=$2
  if ! grep -q "$line_to_add" "${file_to_add_to}"; then
    touched=1
    echo "$line_to_add" | sudo tee -a "${file_to_add_to}" > /dev/null
    echo "$line_to_add added to ${file_to_add_to}"
  else
    if [[ "$DEBUG" == "true" ]]; then
      echo "$line_to_add already exists in ${file_to_add_to}"
    fi
  fi
}

if [[ ! -f "/etc/sysctl.conf" ]]; then
  echo '' >> /etc/sysctl.conf
fi

set -eux
ulimit -Hn 106536
ulimit -Sn 106536
linerrr '*                hard    nofile          1065536' /etc/security/limits.d/filesOpne.conf
linerrr '*                soft    nofile          1065536' /etc/security/limits.d/filesOpne.conf
linerrr 'fs.file-max = 1000000' /etc/sysctl.d/fileLimit.conf 
linerrr 'fs.inotify.max_user_instances = 1024' /etc/sysctl.d/fileLimit.conf 
sysctl -p
#/etc/sysctl.d/fileLimit.conf
