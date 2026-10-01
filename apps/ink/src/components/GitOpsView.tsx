import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { loadProjectConfig } from '@vow/orchestrator';

const execAsync = promisify(exec);

interface GitOpsViewProps {
  onBack: () => void;
}

export const GitOpsView: React.FC<GitOpsViewProps> = ({ onBack }) => {
  const [argoApps, setArgoApps] = useState<any[]>([]);
  const [fluxReleases, setFluxReleases] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const argoRes = await execAsync('kubectl get applications.argoproj.io -A -o json 2>/dev/null || echo {}');
      const parsedArgo = JSON.parse(argoRes.stdout || '{}');
      if (parsedArgo.items) {
        setArgoApps(parsedArgo.items.map((i: any) => ({
          name: i.metadata?.name,
          namespace: i.metadata?.namespace,
          sync: i.status?.sync?.status || 'Unknown',
          health: i.status?.health?.status || 'Unknown',
        })));
      }

      const fluxRes = await execAsync('kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o json 2>/dev/null || echo {}');
      const parsedFlux = JSON.parse(fluxRes.stdout || '{}');
      if (parsedFlux.items) {
        setFluxReleases(parsedFlux.items.map((i: any) => {
          const ready = (i.status?.conditions || []).find((c: any) => c.type === 'Ready');
          return {
            name: i.metadata?.name,
            namespace: i.metadata?.namespace,
            ready: ready ? ready.status === 'True' : false,
            message: ready?.message || 'Unknown',
          };
        }));
      }
    } catch {
      // Ignore
    } finally {
      setLoading(false);
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
    }
  });

  const config = loadProjectConfig(process.cwd());

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="yellow">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="yellow">
          🔄 GitOps Multi-CD Parity & Status Dashboard
        </Text>
        <Text color="gray">
          Configured Runner: {config.cluster.cdRunner.toUpperCase()} | Press 'r' to refresh | 'b' to return
        </Text>
      </Box>

      {loading ? (
        <Text color="yellow">Fetching live cluster GitOps telemetry...</Text>
      ) : (
        <Box flexDirection="column">
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color="cyan">ArgoCD Applications ({argoApps.length}):</Text>
            {argoApps.length > 0 ? (
              argoApps.map((app) => (
                <Box key={app.name} justifyContent="space-between" paddingLeft={1}>
                  <Text color="white">• {app.name.padEnd(25)} (ns: {app.namespace})</Text>
                  <Box gap={2}>
                    <Text color={app.sync === 'Synced' ? 'green' : 'yellow'}>Sync: {app.sync}</Text>
                    <Text color={app.health === 'Healthy' ? 'green' : 'red'}>Health: {app.health}</Text>
                  </Box>
                </Box>
              ))
            ) : (
              <Box paddingLeft={1}>
                <Text color="gray">No ArgoCD applications currently active or CRDs pending.</Text>
              </Box>
            )}
          </Box>

          <Box flexDirection="column">
            <Text bold color="magenta">FluxCD HelmReleases ({fluxReleases.length}):</Text>
            {fluxReleases.length > 0 ? (
              fluxReleases.map((rel) => (
                <Box key={rel.name} justifyContent="space-between" paddingLeft={1}>
                  <Text color="white">• {rel.name.padEnd(25)} (ns: {rel.namespace})</Text>
                  <Text color={rel.ready ? 'green' : 'yellow'}>{rel.ready ? 'Ready: True' : rel.message}</Text>
                </Box>
              ))
            ) : (
              <Box paddingLeft={1}>
                <Text color="gray">No FluxCD HelmReleases currently active or CRDs pending.</Text>
              </Box>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};
