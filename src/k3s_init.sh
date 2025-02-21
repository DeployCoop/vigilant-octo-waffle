#!/bin/bash
SECRET=$(cat /var/lib/rancher/k3s/server/token)
THIS_FILE=/root/k3s_init_node.sh

echo '#!/bin/bash
export THIS_IP=$(curl icanhazip.com)
' >> ${THIS_FILE}

echo 'export K3S_TOKEN=${SECRET}
curl -sfL https://get.k3s.io | sh -s - server \
    --cluster-init \' >> ${THIS_FILE}

echo '    --tls-san=${THIS_IP}
' >> ${THIS_FILE}
