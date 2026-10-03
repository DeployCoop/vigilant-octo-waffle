import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { generateModularSecretBundles, syncSecretsAcrossNamespaces, MODULAR_SECRET_BUNDLES } from '@vow/orchestrator';

interface SecretsViewProps {
  onBack: () => void;
}

export const SecretsView: React.FC<SecretsViewProps> = ({ onBack }) => {
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const runSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Synchronizing secrets across namespaces...');
    try {
      const res = await syncSecretsAcrossNamespaces(process.cwd(), { applyLiveCluster: true });
      setSyncStatus(`✔ Synchronized secrets across ${res.syncedNamespaces.length} namespaces: ${res.syncedNamespaces.join(', ')}`);
    } catch (err: any) {
      setSyncStatus(`✖ Secret sync failed: ${err.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (input === 's' && !isSyncing) {
      runSync();
    }
  });

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="magenta">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="magenta">
          🔐 Modular Secrets Studio & Cross-Namespace Distribution
        </Text>
        <Text color="gray">
          Press 's' to sync live | 'b' to return
        </Text>
      </Box>

      {syncStatus && (
        <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="green">
          <Text color="green" bold>{syncStatus}</Text>
        </Box>
      )}

      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Defined Modular Secret Bundles (Reflector Enabled):</Text>
        {MODULAR_SECRET_BUNDLES.map((bundle) => (
          <Box key={bundle.id} flexDirection="column" marginY={0} paddingLeft={1}>
            <Box gap={1}>
              <Text bold color="cyan">• {bundle.name} ({bundle.id}):</Text>
              <Text color="gray">{bundle.description}</Text>
            </Box>
            <Box paddingLeft={2} gap={2}>
              <Text color="yellow">Target Namespaces: {bundle.targetNamespaces.join(', ')}</Text>
              <Text color="gray">Keys: {bundle.keys.join(', ')}</Text>
            </Box>
          </Box>
        ))}
      </Box>

      <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="gray">
        <Text color="gray">
          Emberstack Reflector projection annotations automatically generated on primary secrets in user namespace.
        </Text>
      </Box>
    </Box>
  );
};
