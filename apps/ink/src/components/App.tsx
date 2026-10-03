import React, { useState } from 'react';
import { Box, useApp } from 'ink';
import { Header } from './Header.js';
import { Navigation, type MenuItem } from './Navigation.js';
import { ClusterUpView } from './ClusterUpView.js';
import { DoctorView } from './DoctorView.js';
import { SecretsView } from './SecretsView.js';
import { NamespacesView } from './NamespacesView.js';
import { GitOpsView } from './GitOpsView.js';
import { StorageView } from './StorageView.js';
import { WaffleView } from './WaffleView.js';
import { IngressView } from './IngressView.js';
import { AppsView } from './AppsView.js';
import { K3sAdminView } from './K3sAdminView.js';

export const MENU_ITEMS: MenuItem[] = [
  { id: 'up', label: 'Bring Up Cluster', icon: '🚀', description: 'Interactive multi-step cluster bring-up sequence' },
  { id: 'doctor', label: 'Config Doctor', icon: '🩺', description: 'Audit & reconcile cascaded variables in .env' },
  { id: 'ingress', label: 'Ingress & TLS Fabric', icon: '🌐', description: 'Traefik/Nginx/HAProxy controllers & Cert-Manager issuers' },
  { id: 'apps', label: 'App Catalog Deployer', icon: '📦', description: 'Browse, deploy, and inspect 40+ modular applications' },
  { id: 'storage', label: 'Storage Fabric', icon: '💾', description: 'Live IOPS & sequential write performance benchmark' },
  { id: 'k3s', label: 'K3s Health & CIS', icon: '🛡️', description: 'API server latency watchdog & CIS security audit' },
  { id: 'secrets', label: 'Secrets Studio', icon: '🔐', description: 'Modular secrets & cross-namespace Reflector sync' },
  { id: 'namespaces', label: 'Namespaces & PSS', icon: '☸️', description: 'Declarative namespace registry & security enforcement' },
  { id: 'gitops', label: 'GitOps CD Status', icon: '🔄', description: 'ArgoCD & FluxCD parity aggregator & drift viewer' },
  { id: 'waffle', label: 'Waffle Pipelines', icon: '🧇', description: 'Execute & simulate multi-tier meta-package blueprints' },
  { id: 'exit', label: 'Exit', icon: '❌', description: 'Quit Vigilant Octo Waffle Ink CLI' },
];

interface AppProps {
  initialScreen?: string;
  dryRun?: boolean;
}

export const App: React.FC<AppProps> = ({ initialScreen = 'menu', dryRun = false }) => {
  const [screen, setScreen] = useState<string>(initialScreen);
  const { exit } = useApp();

  const handleSelect = (item: MenuItem) => {
    if (item.id === 'exit') {
      exit();
    } else {
      setScreen(item.id);
    }
  };

  const handleBack = () => {
    setScreen('menu');
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Header activeScreen={screen === 'menu' ? undefined : screen} />

      {screen === 'menu' && (
        <Navigation
          items={MENU_ITEMS}
          onSelect={handleSelect}
          onExit={exit}
        />
      )}

      {screen === 'up' && <ClusterUpView onBack={handleBack} dryRun={dryRun} />}
      {screen === 'doctor' && <DoctorView onBack={handleBack} />}
      {screen === 'ingress' && <IngressView onBack={handleBack} />}
      {screen === 'apps' && <AppsView onBack={handleBack} />}
      {screen === 'storage' && <StorageView onBack={handleBack} />}
      {screen === 'k3s' && <K3sAdminView onBack={handleBack} />}
      {screen === 'secrets' && <SecretsView onBack={handleBack} />}
      {screen === 'namespaces' && <NamespacesView onBack={handleBack} />}
      {screen === 'gitops' && <GitOpsView onBack={handleBack} />}
      {screen === 'waffle' && <WaffleView onBack={handleBack} />}
    </Box>
  );
};
