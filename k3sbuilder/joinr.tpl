ssh ${TARGET} "export K3S_TOKEN='${K3S_TOKEN}' ; export INSTALL_K3S_EXEC='${INSTALL_K3S_EXEC}' && ./join.sh"
