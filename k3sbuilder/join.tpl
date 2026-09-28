#!/bin/bash
export THIS_IP=${TARGET}
export K3S_URL='https://${MASTER_IP}:6443'
curl -sfL https://get.k3s.io | sh -s -
