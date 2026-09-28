#!/usr/bin/env bash

main () {

cd /root/k3sbuilder

./kill.sh

set -eu

./up.sh
./modr.sh
./filerunnerrr.sh
./registries.sh
./joinr.sh

}

time main $@
