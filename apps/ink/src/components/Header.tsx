import React from 'react';
import { Box, Text } from 'ink';
import { loadProjectConfig, type VowConfig } from '@vow/orchestrator';

interface HeaderProps {
  config?: VowConfig;
  activeScreen?: string;
}

export const Header: React.FC<HeaderProps> = ({ config, activeScreen }) => {
  const currentConfig = config || loadProjectConfig(process.cwd());
  const clusterName = currentConfig.raw.THIS_NAME || 'example';
  const platform = currentConfig.cluster.k8sPlatform.toUpperCase();
  const domain = currentConfig.cluster.domain;
  const ingress = currentConfig.cluster.ingress;
  const runner = currentConfig.cluster.cdRunner.toUpperCase();

  return (
    <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          🧇 VIGILANT OCTO WAFFLE
        </Text>
        <Text color="gray">
          Ink CLI v1.0.0 {activeScreen ? `[ ${activeScreen.toUpperCase()} ]` : ''}
        </Text>
      </Box>
      <Box marginTop={1} gap={2}>
        <Text color="green">
          ● Platform: <Text bold color="white">{platform}</Text>
        </Text>
        <Text color="blue">
          ● Cluster: <Text bold color="white">{clusterName}</Text>
        </Text>
        <Text color="magenta">
          ● Ingress: <Text bold color="white">{ingress}</Text>
        </Text>
        <Text color="yellow">
          ● GitOps: <Text bold color="white">{runner}</Text>
        </Text>
        <Text color="gray">
          ● Domain: <Text color="white">{domain}</Text>
        </Text>
      </Box>
    </Box>
  );
};
