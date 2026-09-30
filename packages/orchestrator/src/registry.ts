import { listCustomApps } from './scaffold.js';
import { listLocalCharts } from './helm.js';

export type AppCategory =
  | 'DevOps & GitOps'
  | 'Security & Identity'
  | 'Databases & Storage'
  | 'AI, ML & GPU'
  | 'Observability & Monitoring'
  | 'Collaboration & Business'
  | 'Messaging & IoT'
  | 'Networking & Ingress'
  | 'Custom & Local Charts';

export interface AppDefinition {
  id: string;
  name: string;
  category: AppCategory;
  description: string;
  enablerVar: string;
  argoPath?: string;
  initPath?: string;
  subdomain?: string;
  port?: number;
  docsUrl?: string;
  icon?: string; // lucide icon name
  estimatedMemoryMb?: number;
  dependencies?: string[];
  isLocalChart?: boolean;
  chartPath?: string;
  chartVersion?: string;
  appVersion?: string;
}

export interface DeploymentPreset {
  id: string;
  name: string;
  description: string;
  estimatedMemoryMb: number;
  apps: string[];
}

export const APP_CATALOG: AppDefinition[] = [
  // DevOps & GitOps
  {
    id: 'argocd',
    name: 'ArgoCD',
    category: 'DevOps & GitOps',
    description: 'Declarative, GitOps continuous delivery tool for Kubernetes',
    enablerVar: 'ARGOCD_ENABLED',
    argoPath: 'argo/argo-cd',
    subdomain: 'argocd',
    port: 443,
    docsUrl: 'https://argo-cd.readthedocs.io/',
    icon: 'GitBranch',
    estimatedMemoryMb: 512,
  },
  {
    id: 'flux',
    name: 'FluxCD',
    category: 'DevOps & GitOps',
    description: 'Open and extensible GitOps continuous delivery solution for Kubernetes (Toolkit v2)',
    enablerVar: 'FLUX_ENABLED',
    argoPath: 'argo/flux',
    subdomain: 'flux',
    port: 443,
    docsUrl: 'https://fluxcd.io/',
    icon: 'GitBranch',
    estimatedMemoryMb: 512,
  },
  {
    id: 'goharbor',
    name: 'Harbor Registry',
    category: 'DevOps & GitOps',
    description: 'Cloud Native repository for storing and scanning container images and Helm charts',
    enablerVar: 'GOHARBOR_ENABLED',
    argoPath: 'argo/goharbor',
    subdomain: 'harbor',
    port: 443,
    docsUrl: 'https://goharbor.io/docs/',
    icon: 'Container',
    estimatedMemoryMb: 1024,
    dependencies: ['kubegres'],
  },
  {
    id: 'rancher',
    name: 'Rancher',
    category: 'DevOps & GitOps',
    description: 'Complete container management platform for multi-cluster Kubernetes',
    enablerVar: 'RANCHER_ENABLED',
    argoPath: 'argo/rancher',
    subdomain: 'rancher',
    port: 443,
    docsUrl: 'https://rancher.com/docs/',
    icon: 'LayoutGrid',
    estimatedMemoryMb: 1536,
  },
  {
    id: 'velero',
    name: 'Velero',
    category: 'DevOps & GitOps',
    description: 'Backup and migrate Kubernetes applications and persistent volumes',
    enablerVar: 'VELERO_ENABLED',
    argoPath: 'argo/velero',
    docsUrl: 'https://velero.io/docs/',
    icon: 'Archive',
    estimatedMemoryMb: 256,
  },
  {
    id: 'spegel',
    name: 'Spegel',
    category: 'DevOps & GitOps',
    description: 'Stateless peer-to-peer registry mirror for Kubernetes worker nodes',
    enablerVar: 'SPEGEL_ENABLED',
    argoPath: 'argo/spegel',
    subdomain: 'spegel',
    docsUrl: 'https://spegel.dev/',
    icon: 'Share2',
    estimatedMemoryMb: 128,
  },
  {
    id: 'nextjs-docker',
    name: 'Next.js App',
    category: 'DevOps & GitOps',
    description: 'Containerized Next.js application deployment with cache PVC and ingress',
    enablerVar: 'NEXTJS_DOCKER_ENABLED',
    argoPath: 'argo/nextjs-docker',
    subdomain: 'nextjsdocker',
    port: 443,
    icon: 'AppWindow',
    estimatedMemoryMb: 256,
  },

  // Security & Identity
  {
    id: 'keycloak',
    name: 'Keycloak',
    category: 'Security & Identity',
    description: 'Open source Identity and Access Management (OAuth2, OIDC, SAML)',
    enablerVar: 'KEYCLOAK_ENABLED',
    argoPath: 'argo/keycloak',
    initPath: 'init/keycloak',
    subdomain: 'keycloak',
    port: 443,
    docsUrl: 'https://www.keycloak.org/documentation',
    icon: 'ShieldCheck',
    estimatedMemoryMb: 1024,
    dependencies: ['kubegres'],
  },
  {
    id: 'bao',
    name: 'OpenBao',
    category: 'Security & Identity',
    description: 'Open source secret management, dynamic credentials, and encryption-as-a-service',
    enablerVar: 'BAO_ENABLED',
    argoPath: 'argo/bao',
    initPath: 'init/bao',
    subdomain: 'baoui',
    port: 443,
    docsUrl: 'https://openbao.org/docs/',
    icon: 'KeyRound',
    estimatedMemoryMb: 256,
  },
  {
    id: 'openldap',
    name: 'OpenLDAP & phpLDAPadmin',
    category: 'Security & Identity',
    description: 'Directory service daemon and web-based administration client',
    enablerVar: 'OPENLDAP_ENABLED',
    argoPath: 'argo/openldap',
    subdomain: 'phpldapadmin',
    port: 443,
    docsUrl: 'https://www.openldap.org/doc/',
    icon: 'Users',
    estimatedMemoryMb: 256,
  },
  {
    id: 'certmanager',
    name: 'Cert-Manager & mkcert',
    category: 'Security & Identity',
    description: 'Automated TLS certificate controller using local mkcert CA or Let\'s Encrypt',
    enablerVar: 'CERTMANAGER_ENABLED',
    initPath: 'init/certmanager-mkcert',
    docsUrl: 'https://cert-manager.io/docs/',
    icon: 'Lock',
    estimatedMemoryMb: 256,
  },

  // Databases & Storage
  {
    id: 'kubegres',
    name: 'Kubegres (PostgreSQL)',
    category: 'Databases & Storage',
    description: 'Kubernetes operator to manage PostgreSQL clusters with replication & failover',
    enablerVar: 'KUBEGRES_ENABLED',
    initPath: 'init/kubegres',
    docsUrl: 'https://www.kubegres.io/',
    icon: 'Database',
    estimatedMemoryMb: 512,
  },
  {
    id: 'mariadb-operator',
    name: 'MariaDB Operator',
    category: 'Databases & Storage',
    description: 'Kubernetes native operator for managing MariaDB Galera clusters and backups',
    enablerVar: 'MARIADB_OPERATOR_ENABLED',
    argoPath: 'argo/mariadb-operator',
    subdomain: 'mariadb-operator',
    docsUrl: 'https://mariadb.com/kb/en/mariadb-kubernetes-operator/',
    icon: 'Database',
    estimatedMemoryMb: 384,
  },
  {
    id: 'minio-tenant',
    name: 'MinIO Object Storage',
    category: 'Databases & Storage',
    description: 'High-performance, S3-compatible enterprise object storage tenant',
    enablerVar: 'MINIO_TENANT_ENABLED',
    argoPath: 'argo/minio-tenant',
    initPath: 'init/pre-minio-tenant',
    subdomain: 'minio-console',
    port: 443,
    docsUrl: 'https://min.io/docs/minio/kubernetes/upstream/',
    icon: 'HardDrive',
    estimatedMemoryMb: 512,
  },
  {
    id: 'seaweedfs',
    name: 'SeaweedFS',
    category: 'Databases & Storage',
    description: 'Fast distributed storage system for blobs, objects, files, and data lakes',
    enablerVar: 'SEAWEEDFS_ENABLED',
    argoPath: 'argo/seaweedFS',
    subdomain: 'seaweedfs',
    docsUrl: 'https://github.com/seaweedfs/seaweedfs',
    icon: 'Layers',
    estimatedMemoryMb: 512,
  },
  {
    id: 'openebs',
    name: 'OpenEBS',
    category: 'Databases & Storage',
    description: 'Container Attached Storage providing Local PVs (LVM/ZFS) and ReadWriteMany NFS',
    enablerVar: 'OPENEBS_ENABLED',
    argoPath: 'argo/openebs',
    initPath: 'init/openebs',
    docsUrl: 'https://openebs.io/docs',
    icon: 'Server',
    estimatedMemoryMb: 512,
  },
  {
    id: 'rook-ceph-operator',
    name: 'Rook Ceph',
    category: 'Databases & Storage',
    description: 'Cloud-native storage orchestrator for distributed Ceph clusters',
    enablerVar: 'ROOK_CEPH_OPERATOR_ENABLED',
    argoPath: 'argo/rook-ceph-operator',
    initPath: 'init/pre-rook-ceph-operator',
    docsUrl: 'https://rook.io/docs/rook/latest/',
    icon: 'Cpu',
    estimatedMemoryMb: 1024,
  },
  {
    id: 'supabase',
    name: 'Supabase',
    category: 'Databases & Storage',
    description: 'Open source Firebase alternative: Postgres, Auth, Realtime, Instant APIs',
    enablerVar: 'SUPABASE_ENABLED',
    argoPath: 'argo/supabase',
    initPath: 'init/pre-supabase',
    subdomain: 'supa',
    port: 443,
    docsUrl: 'https://supabase.com/docs',
    icon: 'Zap',
    estimatedMemoryMb: 1024,
    dependencies: ['kubegres'],
  },
  {
    id: 'trino',
    name: 'Trino',
    category: 'Databases & Storage',
    description: 'Fast distributed SQL query engine for big data and lakehouses',
    enablerVar: 'TRINO_ENABLED',
    argoPath: 'argo/trino',
    subdomain: 'trino',
    docsUrl: 'https://trino.io/docs/current/',
    icon: 'Search',
    estimatedMemoryMb: 1024,
  },

  // Observability & Monitoring
  {
    id: 'kube-prometheus-stack',
    name: 'Prometheus & Grafana',
    category: 'Observability & Monitoring',
    description: 'Full metrics monitoring stack with Prometheus, Grafana, and Alertmanager',
    enablerVar: 'KUBE_PROMETHEUS_STACK_ENABLED',
    argoPath: 'argo/kube-prometheus-stack',
    subdomain: 'grafana',
    port: 443,
    docsUrl: 'https://prometheus-community.github.io/helm-charts/',
    icon: 'LineChart',
    estimatedMemoryMb: 1536,
  },
  {
    id: 'opensearch',
    name: 'OpenSearch & Dashboards',
    category: 'Observability & Monitoring',
    description: 'Distributed search and analytics suite with real-time visualization dashboards',
    enablerVar: 'OPENSEARCH_ENABLED',
    argoPath: 'argo/opensearch',
    subdomain: 'opensearch-dashboards',
    port: 443,
    docsUrl: 'https://opensearch.org/docs/latest/',
    icon: 'SearchCode',
    estimatedMemoryMb: 2048,
  },
  {
    id: 'kubeshark',
    name: 'Kubeshark',
    category: 'Observability & Monitoring',
    description: 'Deep network packet inspector and traffic analyzer for Kubernetes (Wireshark for k8s)',
    enablerVar: 'KUBESHARK_ENABLED',
    argoPath: 'argo/kubeshark',
    subdomain: 'kubeshark',
    port: 443,
    docsUrl: 'https://docs.kubeshark.co/',
    icon: 'Radio',
    estimatedMemoryMb: 512,
  },
  {
    id: 'opentelemetry-operator',
    name: 'OpenTelemetry Operator',
    category: 'Observability & Monitoring',
    description: 'Manages OpenTelemetry Collectors and auto-instrumentation for traces and metrics',
    enablerVar: 'OPENTELEMETRY_OPERATOR_ENABLED',
    argoPath: 'argo/opentelemetry-operator',
    initPath: 'init/opentelemetry-operator',
    docsUrl: 'https://opentelemetry.io/docs/',
    icon: 'Activity',
    estimatedMemoryMb: 256,
  },
  {
    id: 'fluent-bit',
    name: 'Fluent Bit',
    category: 'Observability & Monitoring',
    description: 'Fast, lightweight log processor and forwarder for Kubernetes',
    enablerVar: 'FLUENT_BIT_ENABLED',
    argoPath: 'argo/fluent-bit',
    docsUrl: 'https://fluentbit.io/documentation/',
    icon: 'FileText',
    estimatedMemoryMb: 128,
  },
  {
    id: 'sloth',
    name: 'Sloth',
    category: 'Observability & Monitoring',
    description: 'Easy, reliable Prometheus Service Level Objectives (SLOs) and error budgets',
    enablerVar: 'SLOTH_ENABLED',
    argoPath: 'argo/sloth',
    subdomain: 'sloth',
    docsUrl: 'https://sloth.dev/',
    icon: 'Gauge',
    estimatedMemoryMb: 128,
  },
  {
    id: 'vigil',
    name: 'Vigil',
    category: 'Observability & Monitoring',
    description: 'Open source status page and infrastructure monitoring service',
    enablerVar: 'VIGIL_ENABLED',
    argoPath: 'argo/vigil',
    subdomain: 'vigil',
    docsUrl: 'https://github.com/valeriansaliou/vigil',
    icon: 'BellRing',
    estimatedMemoryMb: 128,
  },

  // Collaboration & Business
  {
    id: 'nextcloud',
    name: 'Nextcloud Hub',
    category: 'Collaboration & Business',
    description: 'Self-hosted productivity platform: file storage, calendar, contacts, and Collabora Office',
    enablerVar: 'NEXTCLOUD_ENABLED',
    argoPath: 'argo/nextcloud',
    subdomain: 'nextcloud',
    port: 443,
    docsUrl: 'https://docs.nextcloud.com/',
    icon: 'Cloud',
    estimatedMemoryMb: 1024,
    dependencies: ['kubegres', 'openebs'],
  },
  {
    id: 'openproject',
    name: 'OpenProject',
    category: 'Collaboration & Business',
    description: 'Open source project management software for classic, agile, and hybrid workflows',
    enablerVar: 'OPENPROJECT_ENABLED',
    argoPath: 'argo/openproject',
    subdomain: 'openproject',
    port: 443,
    docsUrl: 'https://www.openproject.org/docs/',
    icon: 'CheckSquare',
    estimatedMemoryMb: 1024,
    dependencies: ['kubegres'],
  },
  {
    id: 'drupal',
    name: 'Drupal CMS',
    category: 'Collaboration & Business',
    description: 'Enterprise open-source content management framework',
    enablerVar: 'DRUPAL_ENABLED',
    argoPath: 'argo/drupal',
    subdomain: 'drupal',
    port: 443,
    docsUrl: 'https://www.drupal.org/docs',
    icon: 'FileCode',
    estimatedMemoryMb: 512,
    dependencies: ['mariadb-operator'],
  },
  {
    id: 'fossbilling',
    name: 'FOSSBilling',
    category: 'Collaboration & Business',
    description: 'Free and open source hosting management and client billing platform',
    enablerVar: 'FOSSBILLING_ENABLED',
    argoPath: 'argo/fossbilling',
    initPath: 'init/fossbilling',
    subdomain: 'fossbilling',
    port: 443,
    docsUrl: 'https://fossbilling.org/docs',
    icon: 'CreditCard',
    estimatedMemoryMb: 256,
    dependencies: ['mariadb-operator'],
  },
  {
    id: 'opencti',
    name: 'OpenCTI',
    category: 'Collaboration & Business',
    description: 'Cyber Threat Intelligence knowledge platform for managing cybersecurity threats',
    enablerVar: 'OPENCTI_ENABLED',
    argoPath: 'argo/opencti',
    initPath: 'init/opencti',
    subdomain: 'opencti',
    port: 443,
    docsUrl: 'https://docs.opencti.io/',
    icon: 'ShieldAlert',
    estimatedMemoryMb: 1024,
    dependencies: ['opensearch', 'minio-tenant'],
  },
  {
    id: 'resourcespace',
    name: 'ResourceSpace',
    category: 'Collaboration & Business',
    description: 'Digital asset management (DAM) platform for enterprise media and branding',
    enablerVar: 'RESOURCESPACE_ENABLED',
    argoPath: 'argo/resourcespace',
    subdomain: 'resourcespace',
    port: 443,
    docsUrl: 'https://www.resourcespace.com/knowledge-base/',
    icon: 'Image',
    estimatedMemoryMb: 512,
    dependencies: ['mariadb-operator'],
  },

  // AI, ML & GPU
  {
    id: 'kubeflow',
    name: 'Kubeflow',
    category: 'AI, ML & GPU',
    description: 'Complete cloud-native machine learning toolkit for Kubernetes',
    enablerVar: 'KUBEFLOW_ENABLED',
    argoPath: 'argo/kubeflow',
    initPath: 'init/kubeflow',
    docsUrl: 'https://www.kubeflow.org/docs/',
    icon: 'Sparkles',
    estimatedMemoryMb: 4096,
  },
  {
    id: 'gpu-operator',
    name: 'NVIDIA GPU Operator',
    category: 'AI, ML & GPU',
    description: 'Automates provisioning of NVIDIA software components on Kubernetes nodes',
    enablerVar: 'GPU_OPERATOR_ENABLED',
    argoPath: 'argo/gpu-operator',
    initPath: 'init/pre-gpu-operator',
    docsUrl: 'https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/latest/',
    icon: 'Cpu',
    estimatedMemoryMb: 512,
  },
  {
    id: 'cvat',
    name: 'CVAT',
    category: 'AI, ML & GPU',
    description: 'Computer Vision Annotation Tool for images, video, and AI dataset labeling',
    enablerVar: 'CVAT_ENABLED',
    argoPath: 'argo/cvat',
    subdomain: 'cvat',
    port: 443,
    docsUrl: 'https://opencv.github.io/cvat/docs/',
    icon: 'Video',
    estimatedMemoryMb: 1024,
    dependencies: ['kubegres'],
  },
  {
    id: 'node-feature-discovery',
    name: 'Node Feature Discovery',
    category: 'AI, ML & GPU',
    description: 'Detects hardware features, instruction sets, and accelerators on k8s nodes',
    enablerVar: 'NODE_FEATURE_DISCOVERY_ENABLED',
    argoPath: 'argo/node-feature-discovery',
    initPath: 'init/pre-node-feature-discovery',
    docsUrl: 'https://kubernetes-sigs.github.io/node-feature-discovery/',
    icon: 'Microchip',
    estimatedMemoryMb: 128,
  },
  {
    id: 'ollama',
    name: 'Ollama (In-Cluster LLM)',
    category: 'AI, ML & GPU',
    description: 'Get up and running with large language models locally inside your Kubernetes cluster',
    enablerVar: 'OLLAMA_ENABLED',
    argoPath: 'argo/ollama',
    subdomain: 'ollama',
    port: 11434,
    docsUrl: 'https://ollama.com/',
    icon: 'Bot',
    estimatedMemoryMb: 2048,
  },
  {
    id: 'vllm',
    name: 'vLLM Inference Server',
    category: 'AI, ML & GPU',
    description: 'High-throughput and memory-efficient LLM serving engine for Kubernetes clusters',
    enablerVar: 'VLLM_ENABLED',
    argoPath: 'argo/vllm',
    subdomain: 'vllm',
    port: 8000,
    docsUrl: 'https://docs.vllm.ai/',
    icon: 'Cpu',
    estimatedMemoryMb: 4096,
  },

  // Messaging & IoT
  {
    id: 'mosquitto',
    name: 'Eclipse Mosquitto (MQTT)',
    category: 'Messaging & IoT',
    description: 'Lightweight publish/subscribe message broker using the MQTT protocol',
    enablerVar: 'AR80_MOSQUITTO_ENABLED',
    argoPath: 'argo/ar80-mosquitto',
    subdomain: 'ar80-mosquitto',
    docsUrl: 'https://mosquitto.org/documentation/',
    icon: 'RadioTower',
    estimatedMemoryMb: 128,
  },
  {
    id: 'vmq-operator',
    name: 'VerneMQ Operator',
    category: 'Messaging & IoT',
    description: 'High-performance, distributed MQTT broker operator with clustering',
    enablerVar: 'VMQ_OPERATOR_ENABLED',
    argoPath: 'argo/vmq-operator',
    initPath: 'init/vmq-operator',
    docsUrl: 'https://vernemq.com/docs/',
    icon: 'Share2',
    estimatedMemoryMb: 256,
  },
  {
    id: 'airflow',
    name: 'Apache Airflow',
    category: 'Messaging & IoT',
    description: 'Platform to programmatically author, schedule, and monitor data workflows',
    enablerVar: 'AIRFLOW_ENABLED',
    argoPath: 'argo/airflow',
    subdomain: 'airflow',
    port: 443,
    docsUrl: 'https://airflow.apache.org/docs/',
    icon: 'Workflow',
    estimatedMemoryMb: 1536,
    dependencies: ['kubegres'],
  },
];

export const DEPLOYMENT_PRESETS: DeploymentPreset[] = [
  {
    id: 'minimal',
    name: 'Core / Minimal',
    description: 'ArgoCD + Ingress + Cert-Manager (Ideal for low-resource laptops)',
    estimatedMemoryMb: 1536,
    apps: ['argocd', 'certmanager'],
  },
  {
    id: 'storage',
    name: 'Dev & Storage',
    description: 'Core + PostgreSQL (Kubegres) + MinIO S3 + OpenEBS',
    estimatedMemoryMb: 3584,
    apps: ['argocd', 'certmanager', 'kubegres', 'minio-tenant', 'openebs'],
  },
  {
    id: 'observability',
    name: 'Observability Stack',
    description: 'Core + Prometheus, Grafana, OpenSearch & Dashboards, Sloth, Vigil',
    estimatedMemoryMb: 6144,
    apps: ['argocd', 'certmanager', 'kube-prometheus-stack', 'opensearch', 'sloth', 'vigil'],
  },
  {
    id: 'ai',
    name: 'AI & Machine Learning',
    description: 'Core + Kubeflow, CVAT, NVIDIA GPU Operator, Node Feature Discovery, Ollama, vLLM',
    estimatedMemoryMb: 12288,
    apps: ['argocd', 'certmanager', 'kubegres', 'kubeflow', 'cvat', 'gpu-operator', 'node-feature-discovery', 'ollama', 'vllm'],
  },
  {
    id: 'collaboration',
    name: 'Productivity & Business',
    description: 'Core + Nextcloud, OpenProject, Drupal CMS, Keycloak IAM',
    estimatedMemoryMb: 6144,
    apps: ['argocd', 'certmanager', 'kubegres', 'openebs', 'keycloak', 'nextcloud', 'openproject', 'drupal'],
  },
  {
    id: 'full',
    name: 'Full Suite',
    description: 'All 45+ applications and operators (High-memory workstation / 32GB+ RAM)',
    estimatedMemoryMb: 24576,
    apps: APP_CATALOG.map((a) => a.id),
  },
];

/**
 * Returns the combined catalog of built-in applications, custom scaffolded apps,
 * and automatically discovered local Helm charts from the configured charts directory.
 */
export function getCombinedAppCatalog(
  projectRoot: string,
  customChartsDir?: string
): AppDefinition[] {
  // Dynamically import or lazily load to preserve fast startup
  const combined = [...APP_CATALOG];
  const seenIds = new Set(APP_CATALOG.map((a) => a.id));

  // 1. Merge custom apps (.custom_apps.json)
  try {
    const customApps = listCustomApps(projectRoot);
    for (const ca of customApps) {
      if (!seenIds.has(ca.id)) {
        seenIds.add(ca.id);
        combined.push({
          id: ca.id,
          name: ca.name,
          category: ca.category,
          description: ca.description,
          enablerVar: ca.enablerVar,
          subdomain: ca.subdomain,
          port: ca.port,
          icon: 'Layers',
          estimatedMemoryMb: ca.estimatedMemoryMb || 256,
          dependencies: ca.dependencies,
        });
      }
    }
  } catch {
    // Scaffold module not available or empty
  }

  // 2. Merge discovered local Helm charts
  try {
    const localCharts = listLocalCharts(projectRoot, customChartsDir);
    for (const lc of localCharts) {
      if (!seenIds.has(lc.id)) {
        seenIds.add(lc.id);
        combined.push({
          id: lc.id,
          name: lc.name,
          category: 'Custom & Local Charts',
          description: lc.description,
          enablerVar: lc.enablerVar,
          subdomain: lc.id,
          port: 80,
          docsUrl: lc.home,
          icon: lc.icon && lc.icon !== 'Ship' ? lc.icon : 'Ship',
          estimatedMemoryMb: 256,
          isLocalChart: true,
          chartPath: lc.chartPath,
          chartVersion: lc.version,
          appVersion: lc.appVersion,
        });
      }
    }
  } catch {
    // Helm module not available or directory empty
  }

  return combined;
}
