import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { discoverClusterNamespaces, applyClusterNamespaces, type NamespaceDiscoveryResult } from '@vow/orchestrator';

interface NamespacesViewProps {
  onBack: () => void;
}

export const NamespacesView: React.FC<NamespacesViewProps> = ({ onBack }) => {
  const [data, setData] = useState<NamespaceDiscoveryResult | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const load = () => {
    const res = discoverClusterNamespaces(process.cwd());
    setData(res);
  };

  const sync = async () => {
    setIsSyncing(true);
    setSyncMessage('Applying declarative namespaces with PSS standards to cluster...');
    try {
      const res = await applyClusterNamespaces(process.cwd());
      setSyncMessage(`✔ Applied ${res.total} namespaces to Kubernetes cluster.`);
    } catch (err: any) {
      setSyncMessage(`✖ Failed to apply namespaces: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (input === 's' && !isSyncing) {
      sync();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="cyan">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          ☸️ Declarative Namespaces & Pod Security Standards (PSS)
        </Text>
        <Text color="gray">
          Press 's' to apply live | 'b' to return
        </Text>
      </Box>

      {syncMessage && (
        <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="green">
          <Text color="green" bold>{syncMessage}</Text>
        </Box>
      )}

      {data && (
        <Box flexDirection="column">
          <Box justifyContent="space-between" marginBottom={1}>
            <Text bold color="white">
              Total Discovered Namespaces: {data.total}
            </Text>
            <Text color="gray">
              Categories: {Object.keys(data.byCategory).join(', ')}
            </Text>
          </Box>

          <Box flexDirection="column">
            {data.namespaces.map((ns) => {
              const isPriv = ns.pssEnforce === 'privileged';
              return (
                <Box key={ns.name} justifyContent="space-between" paddingLeft={1}>
                  <Box gap={1}>
                    <Text bold color={isPriv ? 'red' : 'green'}>
                      {isPriv ? '⚡' : '🛡'} {ns.name.padEnd(20)}
                    </Text>
                    <Text color="gray">[{ns.category.toUpperCase()}]</Text>
                    <Text color="gray">source: {ns.source || 'default'}</Text>
                  </Box>
                  <Box gap={1}>
                    <Text color={isPriv ? 'red' : 'green'}>enforce={ns.pssEnforce}</Text>
                    <Text color="yellow">warn={ns.pssWarn}</Text>
                  </Box>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
};
