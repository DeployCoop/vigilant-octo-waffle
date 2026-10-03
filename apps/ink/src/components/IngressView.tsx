import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import {
  getIngressFabricStatus,
  deployIngressFabric,
  setupMkcert,
  setupLetsEncrypt,
  type IngressFabricStatus,
} from '@vow/orchestrator';

interface IngressViewProps {
  onBack: () => void;
}

export const IngressView: React.FC<IngressViewProps> = ({ onBack }) => {
  const [status, setStatus] = useState<IngressFabricStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await getIngressFabricStatus(process.cwd());
      setStatus(res);
    } catch {
      // Ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDeploy = async () => {
    setActionMessage('Deploying ingress fabric controller...');
    try {
      const res = await deployIngressFabric(process.cwd());
      setActionMessage(res.success ? `✔ ${res.message}` : `✖ ${res.message}: ${res.error}`);
      await fetchStatus();
    } catch (err: any) {
      setActionMessage(`✖ Deploy error: ${err.message}`);
    }
  };

  const handleCerts = async () => {
    setActionMessage('Configuring TLS cluster certificates...');
    try {
      await setupMkcert(process.cwd());
      setActionMessage('✔ mkcert certificates configured');
      await fetchStatus();
    } catch {
      try {
        await setupLetsEncrypt(process.cwd());
        setActionMessage('✔ Let\'s Encrypt certificates configured');
        await fetchStatus();
      } catch (err: any) {
        setActionMessage(`✖ Cert error: ${err.message}`);
      }
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (input === 'r') {
      fetchStatus();
      setActionMessage(null);
    } else if (input === 'd') {
      handleDeploy();
    } else if (input === 'c') {
      handleCerts();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="cyan">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          🌐 Ingress & TLS Fabric Controller
        </Text>
        <Text color="gray">
          Press 'd' to deploy | 'c' for certs | 'r' to refresh | 'b' to return
        </Text>
      </Box>

      {actionMessage && (
        <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="yellow">
          <Text color="yellow" bold>{actionMessage}</Text>
        </Box>
      )}

      {loading && (
        <Box marginY={1}>
          <Text color="cyan"><Spinner type="dots" /> Inspecting ingress classes and TLS issuers...</Text>
        </Box>
      )}

      {!loading && status && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold>Active Provider: </Text>
            <Text color="green" bold>{status.activeProvider.toUpperCase()}</Text>
            <Text> | Status: </Text>
            <Text color={status.isControllerReady ? 'green' : 'yellow'}>
              {status.isControllerReady ? '● Ready / Operational' : '○ Pending / Offline'}
            </Text>
            <Text> | Ingress Classes: </Text>
            <Text color="cyan">{status.ingressClasses.join(', ') || 'none'}</Text>
          </Box>

          <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <Text bold color="yellow">🔒 Cert-Manager & ClusterIssuers</Text>
            <Box>
              <Text>Installed: </Text>
              <Text color={status.certManager.isInstalled ? 'green' : 'red'}>
                {status.certManager.isInstalled ? 'YES' : 'NO'}
              </Text>
              <Text> | Pods Ready: </Text>
              <Text color={status.certManager.podsReady ? 'green' : 'yellow'}>
                {status.certManager.podsReady ? 'YES' : 'NO'}
              </Text>
            </Box>
            {status.certManager.issuers.length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
                {status.certManager.issuers.map((iss) => (
                  <Box key={iss.name}>
                    <Text color={iss.ready ? 'green' : 'red'}>{iss.ready ? '✔' : '✖'} </Text>
                    <Text bold>{iss.name.padEnd(25)}</Text>
                    <Text color="gray">[{iss.type}] </Text>
                    <Text color={iss.ready ? 'green' : 'yellow'}>{iss.status}</Text>
                  </Box>
                ))}
              </Box>
            ) : (
              <Text color="gray" italic>No ClusterIssuers found in cluster</Text>
            )}
          </Box>

          <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
            <Text bold color="cyan">Routing Rules ({status.ingresses.length} routes)</Text>
            {status.ingresses.length > 0 ? (
              <Box flexDirection="column" marginTop={1}>
                {status.ingresses.map((ing) => (
                  <Box key={`${ing.namespace}/${ing.name}`}>
                    <Text color="cyan">{ing.namespace.padEnd(16)}</Text>
                    <Text bold>{ing.name.padEnd(24)}</Text>
                    <Text color="green">{ing.host.padEnd(30)}</Text>
                    <Text color="gray">class={ing.class || 'default'}</Text>
                  </Box>
                ))}
              </Box>
            ) : (
              <Text color="gray" italic>No active ingresses discovered in cluster</Text>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};
