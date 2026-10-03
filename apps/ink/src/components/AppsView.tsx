import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import {
  listCatalogApps,
  deployCatalogApp,
  removeCatalogApp,
  type CatalogAppMeta,
} from '@vow/orchestrator';

interface AppsViewProps {
  onBack: () => void;
}

export const AppsView: React.FC<AppsViewProps> = ({ onBack }) => {
  const [apps, setApps] = useState<CatalogAppMeta[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchApps = () => {
    const list = listCatalogApps(process.cwd());
    setApps(list);
  };

  useEffect(() => {
    fetchApps();
  }, []);

  const handleDeploy = async () => {
    const app = apps[selectedIndex];
    if (!app) return;

    setLoading(true);
    setMessage(`Deploying application '${app.appId}'...`);
    try {
      const res = await deployCatalogApp(process.cwd(), app.appId);
      setMessage(res.success ? `✔ ${res.message}` : `✖ ${res.message}: ${res.error}`);
    } catch (err: any) {
      setMessage(`✖ Deploy error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    const app = apps[selectedIndex];
    if (!app) return;

    setLoading(true);
    setMessage(`Removing application '${app.appId}'...`);
    try {
      const res = await removeCatalogApp(process.cwd(), app.appId);
      setMessage(res.success ? `✔ ${res.message}` : `✖ ${res.message}`);
    } catch (err: any) {
      setMessage(`✖ Remove error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useInput((input, key) => {
    if (input === 'b' || key.escape) {
      onBack();
    } else if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : apps.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < apps.length - 1 ? prev + 1 : 0));
    } else if (input === 'd' || key.return) {
      handleDeploy();
    } else if (input === 'x') {
      handleRemove();
    }
  });

  const selectedApp = apps[selectedIndex];
  const visibleApps = apps.slice(Math.max(0, selectedIndex - 5), Math.min(apps.length, selectedIndex + 6));

  return (
    <Box flexDirection="column" padding={1} borderStyle="single" borderColor="magenta">
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="magenta">
          📦 Application Catalog & Unified Deployer ({apps.length} Apps)
        </Text>
        <Text color="gray">
          ↑/↓ to browse | 'd' to deploy | 'x' to remove | 'b' to return
        </Text>
      </Box>

      {message && (
        <Box marginBottom={1} paddingX={1} borderStyle="round" borderColor="yellow">
          <Text color="yellow" bold>{message}</Text>
        </Box>
      )}

      {loading && (
        <Box marginY={1}>
          <Text color="magenta"><Spinner type="dots" /> Orchestrating application resources...</Text>
        </Box>
      )}

      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="column" width="55%">
          <Text bold color="gray">Available Applications:</Text>
          {visibleApps.map((app) => {
            const isSelected = selectedApp?.appId === app.appId;
            return (
              <Box key={app.appId}>
                <Text color={isSelected ? 'magenta' : 'gray'} bold={isSelected}>
                  {isSelected ? '❯ ' : '  '}
                  {app.name.padEnd(24)}
                </Text>
                <Text color="gray">[{app.category}]</Text>
              </Box>
            );
          })}
        </Box>

        {selectedApp && (
          <Box flexDirection="column" width="45%" borderStyle="single" borderColor="gray" paddingX={1}>
            <Text bold color="cyan">{selectedApp.name}</Text>
            <Text>ID: <Text color="yellow">{selectedApp.appId}</Text></Text>
            <Text>Category: <Text color="green">{selectedApp.category}</Text></Text>
            <Text>Default Namespace: <Text color="cyan">{selectedApp.defaultNamespace}</Text></Text>
            <Text>Enabler Var: <Text color="gray">{selectedApp.enablerVar}</Text></Text>
            <Box marginTop={1}>
              <Text>ArgoCD Manifest: </Text>
              <Text color={selectedApp.hasArgoManifest ? 'green' : 'red'}>
                {selectedApp.hasArgoManifest ? 'YES' : 'NO'}
              </Text>
            </Box>
            <Box>
              <Text>Local Helm Chart: </Text>
              <Text color={selectedApp.hasLocalChart ? 'green' : 'gray'}>
                {selectedApp.hasLocalChart ? 'YES' : 'NO'}
              </Text>
            </Box>
            <Box>
              <Text>Init Manifests: </Text>
              <Text color={selectedApp.hasInit ? 'green' : 'gray'}>
                {selectedApp.hasInit ? 'YES' : 'NO'}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
