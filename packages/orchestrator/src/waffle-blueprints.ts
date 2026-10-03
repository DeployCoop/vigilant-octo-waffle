import type { WafflePipeline } from './waffle.js';

/**
 * 1. NextJS Application + Supabase Blueprint
 * Full-stack React / Next.js web application paired with Supabase backend (PostgreSQL 16, GoTrue Auth, REST)
 * backed by OpenEBS dynamic LocalPV storage.
 */
export const BLUEPRINT_NEXTJS_SUPABASE: WafflePipeline = {
  apiVersion: 'waffle.dev/v1',
  kind: 'WafflePipeline',
  metadata: {
    name: 'blueprint-nextjs-supabase',
    version: '1.0.0',
    description: 'Modern Full-Stack Next.js SSR application with self-hosted Supabase Auth, PostgreSQL 16 with pgvector, and OpenEBS LocalPV storage.',
    authors: [
      { name: 'Vigilant Octo Waffle Community' },
    ],
    tags: ['nextjs', 'react', 'supabase', 'postgres', 'openebs', 'fullstack'],
  },
  settings: {
    defaultNamespace: 'nextjs-supabase',
    defaultStorageClass: 'openebs-hostpath',
    defaultClusterIssuer: 'letsencrypt-prod',
    globalTimeout: '15m',
    rollbackOnFailure: true,
  },
  preflight: {
    storage: {
      requireStorageClass: 'openebs-hostpath',
      autoInstallOpenEBS: true,
    },
    ingress: {
      requireController: 'nginx',
    },
  },
  stages: [
    {
      id: '00-storage-foundation',
      name: 'Distributed Storage Fabric',
      description: 'Deploy OpenEBS Dynamic LocalPV engine for fast NVMe/SSD volume claims.',
      mode: 'series',
      steps: [
        {
          id: 'openebs',
          name: 'OpenEBS LocalPV Provisioner',
          chart: 'openebs',
          releaseName: 'openebs',
          namespace: 'openebs',
          createNamespace: true,
          wait: true,
          timeout: '5m',
          healthCheck: {
            type: 'storageClass',
            name: 'openebs-hostpath',
            timeout: '3m',
            expectedStatus: 200,
          },
        },
      ],
    },
    {
      id: '10-data-backend',
      name: 'Data & Authentication Engine',
      description: 'Deploy self-hosted Supabase with PostgreSQL 16, pgvector, and Auth REST API.',
      mode: 'series',
      steps: [
        {
          id: 'supabase',
          name: 'Supabase PostgreSQL & Auth',
          chart: 'supabase',
          releaseName: 'supabase',
          namespace: 'nextjs-supabase',
          createNamespace: true,
          wait: true,
          timeout: '8m',
          set: {
            'postgresql.persistence.storageClass': 'openebs-hostpath',
            'postgresql.persistence.size': '20Gi',
          },
          healthCheck: {
            type: 'podReady',
            timeout: '5m',
            expectedStatus: 200,
          },
        },
      ],
    },
    {
      id: '20-web-application',
      name: 'Next.js Frontend Application',
      description: 'Deploy high-performance Next.js application wired to internal Supabase service.',
      mode: 'series',
      steps: [
        {
          id: 'nextjs-app',
          name: 'Next.js Web Portal',
          chart: 'nextjs-app',
          releaseName: 'nextjs-app',
          namespace: 'nextjs-supabase',
          createNamespace: false,
          wait: true,
          timeout: '6m',
          domain: 'app.example.com',
          set: {
            'env.SUPABASE_URL': 'http://supabase-kong:8000',
            'ingress.enabled': 'true',
            'ingress.host': 'app.example.com',
          },
        },
      ],
    },
  ],
};

/**
 * 2. Python Application + MongoDB Blueprint
 * Python FastAPI/Flask microservice coupled with MongoDB StatefulSet utilizing OpenEBS persistent storage.
 */
export const BLUEPRINT_PYTHON_MONGODB: WafflePipeline = {
  apiVersion: 'waffle.dev/v1',
  kind: 'WafflePipeline',
  metadata: {
    name: 'blueprint-python-mongodb',
    version: '1.0.0',
    description: 'Asynchronous Python FastAPI microservice architecture backed by persistent MongoDB StatefulSet on OpenEBS storage.',
    authors: [
      { name: 'Vigilant Octo Waffle Community' },
    ],
    tags: ['python', 'fastapi', 'mongodb', 'openebs', 'microservice'],
  },
  settings: {
    defaultNamespace: 'python-mongo',
    defaultStorageClass: 'openebs-hostpath',
    defaultClusterIssuer: 'letsencrypt-prod',
    globalTimeout: '15m',
    rollbackOnFailure: true,
  },
  preflight: {
    storage: {
      requireStorageClass: 'openebs-hostpath',
      autoInstallOpenEBS: true,
    },
  },
  stages: [
    {
      id: '00-storage-foundation',
      name: 'Distributed Storage Fabric',
      description: 'Provision OpenEBS Dynamic LocalPV hostpath provisioner.',
      mode: 'series',
      steps: [
        {
          id: 'openebs',
          name: 'OpenEBS LocalPV Provisioner',
          chart: 'openebs',
          releaseName: 'openebs',
          namespace: 'openebs',
          createNamespace: true,
          wait: true,
          timeout: '5m',
        },
      ],
    },
    {
      id: '10-document-database',
      name: 'MongoDB Document Datastore',
      description: 'Deploy resilient MongoDB StatefulSet with OpenEBS persistent disk backing.',
      mode: 'series',
      steps: [
        {
          id: 'mongodb',
          name: 'MongoDB StatefulSet',
          chart: 'mongodb',
          releaseName: 'mongodb',
          namespace: 'python-mongo',
          createNamespace: true,
          wait: true,
          timeout: '8m',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '25Gi',
          },
          healthCheck: {
            type: 'podReady',
            timeout: '4m',
            expectedStatus: 200,
          },
        },
      ],
    },
    {
      id: '20-application-service',
      name: 'Python Application Layer',
      description: 'Deploy FastAPI Python application connected to MongoDB cluster.',
      mode: 'series',
      steps: [
        {
          id: 'python-api',
          name: 'FastAPI Backend Service',
          chart: 'python-app',
          releaseName: 'python-api',
          namespace: 'python-mongo',
          createNamespace: false,
          wait: true,
          timeout: '5m',
          domain: 'api.example.com',
          set: {
            'mongodb.uri': 'mongodb://mongodb.python-mongo.svc.cluster.local:27017',
            'ingress.host': 'api.example.com',
          },
        },
      ],
    },
  ],
};

/**
 * 3. Jupyter Notebook + CassandraDB Blueprint
 * Scalable Apache Cassandra NoSQL cluster paired with JupyterLab data science notebook environment.
 */
export const BLUEPRINT_JUPYTER_CASSANDRA: WafflePipeline = {
  apiVersion: 'waffle.dev/v1',
  kind: 'WafflePipeline',
  metadata: {
    name: 'blueprint-jupyter-cassandra',
    version: '1.0.0',
    description: 'High-throughput Apache Cassandra distributed NoSQL ring with interactive JupyterLab workspace for big data analytics.',
    authors: [
      { name: 'Vigilant Octo Waffle Community' },
    ],
    tags: ['jupyter', 'datascience', 'cassandra', 'nosql', 'openebs', 'analytics'],
  },
  settings: {
    defaultNamespace: 'data-analytics',
    defaultStorageClass: 'openebs-hostpath',
    defaultClusterIssuer: 'letsencrypt-prod',
    globalTimeout: '20m',
    rollbackOnFailure: true,
  },
  preflight: {
    storage: {
      requireStorageClass: 'openebs-hostpath',
      autoInstallOpenEBS: true,
    },
  },
  stages: [
    {
      id: '00-storage-foundation',
      name: 'Distributed Storage Fabric',
      description: 'Deploy OpenEBS LocalPV for low-latency Cassandra commit log & SSTable IOPS.',
      mode: 'series',
      steps: [
        {
          id: 'openebs',
          name: 'OpenEBS LocalPV Provisioner',
          chart: 'openebs',
          releaseName: 'openebs',
          namespace: 'openebs',
          createNamespace: true,
          wait: true,
          timeout: '5m',
        },
      ],
    },
    {
      id: '10-nosql-database',
      name: 'Cassandra Distributed Cluster',
      description: 'Deploy 3-node Apache Cassandra ring with dedicated volume claims.',
      mode: 'series',
      steps: [
        {
          id: 'cassandra',
          name: 'Apache Cassandra Cluster',
          chart: 'cassandra',
          releaseName: 'cassandra',
          namespace: 'data-analytics',
          createNamespace: true,
          wait: true,
          timeout: '12m',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '50Gi',
            'replicaCount': 3,
          },
        },
      ],
    },
    {
      id: '20-notebook-lab',
      name: 'Jupyter Interactive Environment',
      description: 'Deploy GPU-ready JupyterLab notebook container pre-wired with cassandra-driver.',
      mode: 'series',
      steps: [
        {
          id: 'jupyterlab',
          name: 'JupyterLab Workspace',
          chart: 'jupyter-notebook',
          releaseName: 'jupyterlab',
          namespace: 'data-analytics',
          createNamespace: false,
          wait: true,
          timeout: '6m',
          domain: 'jupyter.example.com',
          set: {
            'cassandra.host': 'cassandra.data-analytics.svc.cluster.local',
            'ingress.host': 'jupyter.example.com',
          },
        },
      ],
    },
  ],
};

/**
 * 4. kCTF Capture The Flag Setup Blueprint
 * Google kCTF sandboxing framework with nsjail isolation, CTFd scoreboard, and challenge infrastructure.
 */
export const BLUEPRINT_KCTF: WafflePipeline = {
  apiVersion: 'waffle.dev/v1',
  kind: 'WafflePipeline',
  metadata: {
    name: 'blueprint-kctf',
    version: '1.0.0',
    description: 'Enterprise Capture The Flag (CTF) tournament stack featuring Google kCTF nsjail kernel sandboxing, CTFd scoreboard, and challenge daemons.',
    authors: [
      { name: 'Vigilant Octo Waffle Community' },
    ],
    tags: ['kctf', 'security', 'ctf', 'sandboxing', 'nsjail', 'ctfd'],
  },
  settings: {
    defaultNamespace: 'kctf-competition',
    defaultStorageClass: 'openebs-hostpath',
    defaultClusterIssuer: 'letsencrypt-prod',
    globalTimeout: '20m',
    rollbackOnFailure: true,
  },
  preflight: {
    storage: {
      requireStorageClass: 'openebs-hostpath',
      autoInstallOpenEBS: true,
    },
  },
  stages: [
    {
      id: '00-storage-foundation',
      name: 'Storage Infrastructure',
      description: 'Deploy OpenEBS LocalPV for challenge uploads and scoreboard database.',
      mode: 'series',
      steps: [
        {
          id: 'openebs',
          name: 'OpenEBS LocalPV Provisioner',
          chart: 'openebs',
          releaseName: 'openebs',
          namespace: 'openebs',
          createNamespace: true,
          wait: true,
          timeout: '5m',
        },
      ],
    },
    {
      id: '10-kctf-sandboxing',
      name: 'kCTF Kernel Sandboxing Core',
      description: 'Deploy Google kCTF challenge controller, seccomp/ptrace policies, and nsjail daemons.',
      mode: 'series',
      steps: [
        {
          id: 'kctf-cluster',
          name: 'Google kCTF Infrastructure',
          chart: 'kctf-cluster',
          releaseName: 'kctf-cluster',
          namespace: 'kctf-system',
          createNamespace: true,
          wait: true,
          timeout: '8m',
        },
      ],
    },
    {
      id: '20-ctfd-scoreboard',
      name: 'CTFd Scoreboard & User Portal',
      description: 'Deploy CTFd platform with Redis cache, MariaDB, and flag submission engine.',
      mode: 'series',
      steps: [
        {
          id: 'ctfd',
          name: 'CTFd Scoreboard',
          chart: 'ctfd',
          releaseName: 'ctfd',
          namespace: 'kctf-competition',
          createNamespace: true,
          wait: true,
          timeout: '8m',
          domain: 'ctf.example.com',
          set: {
            'ingress.host': 'ctf.example.com',
            'persistence.storageClass': 'openebs-hostpath',
          },
        },
      ],
    },
    {
      id: '30-challenges-suite',
      name: 'Standard Challenge Suite',
      description: 'Deploy containerized challenge fleet across pwn, reverse engineering, web, and crypto.',
      mode: 'parallel',
      steps: [
        {
          id: 'challenge-pwn',
          name: 'Kernel Pwn Challenges',
          chart: 'ctf-challenge-pwn',
          releaseName: 'pwn-challenges',
          namespace: 'kctf-competition',
          wait: false,
          timeout: '5m',
        },
        {
          id: 'challenge-web',
          name: 'Web Exploitation Challenges',
          chart: 'ctf-challenge-web',
          releaseName: 'web-challenges',
          namespace: 'kctf-competition',
          wait: false,
          timeout: '5m',
        },
      ],
    },
  ],
};

/**
 * 5. Zero-Trust Storage Blueprint
 * SeaweedFS S3 object storage with Vault/Keycloak identity brokering and strict Kubernetes NetworkPolicies.
 */
export const BLUEPRINT_ZERO_TRUST_STORAGE: WafflePipeline = {
  apiVersion: 'waffle.dev/v1',
  kind: 'WafflePipeline',
  metadata: {
    name: 'blueprint-zero-trust-storage',
    version: '1.0.0',
    description: 'Zero-Trust object and block storage fabric with SeaweedFS distributed S3, HashiCorp Vault secrets brokering, and strict mTLS NetworkPolicies.',
    authors: [
      { name: 'Vigilant Octo Waffle Community' },
    ],
    tags: ['zero-trust', 'seaweedfs', 's3', 'vault', 'netpol', 'security', 'openebs'],
  },
  settings: {
    defaultNamespace: 'zero-trust-storage',
    defaultStorageClass: 'openebs-hostpath',
    defaultClusterIssuer: 'letsencrypt-prod',
    globalTimeout: '20m',
    rollbackOnFailure: true,
  },
  preflight: {
    storage: {
      requireStorageClass: 'openebs-hostpath',
      autoInstallOpenEBS: true,
    },
  },
  stages: [
    {
      id: '00-storage-foundation',
      name: 'Distributed Storage Fabric',
      description: 'Install OpenEBS Dynamic LocalPV for persistent S3 filer and volume daemon disks.',
      mode: 'series',
      steps: [
        {
          id: 'openebs',
          name: 'OpenEBS LocalPV Provisioner',
          chart: 'openebs',
          releaseName: 'openebs',
          namespace: 'openebs',
          createNamespace: true,
          wait: true,
          timeout: '5m',
        },
      ],
    },
    {
      id: '10-distributed-s3',
      name: 'SeaweedFS Encrypted S3 Engine',
      description: 'Deploy SeaweedFS master, volume, and filer daemons with at-rest encryption.',
      mode: 'series',
      steps: [
        {
          id: 'seaweedfs',
          name: 'SeaweedFS Distributed S3 Store',
          chart: 'seaweedfs',
          releaseName: 'seaweedfs',
          namespace: 'zero-trust-storage',
          createNamespace: true,
          wait: true,
          timeout: '8m',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '50Gi',
          },
        },
      ],
    },
    {
      id: '20-secrets-broker',
      name: 'Vault Zero-Trust Identity Broker',
      description: 'Deploy HashiCorp Vault for dynamic token-based bucket access and certificate signing.',
      mode: 'series',
      steps: [
        {
          id: 'vault',
          name: 'HashiCorp Vault Secret Engine',
          chart: 'vault',
          releaseName: 'vault',
          namespace: 'zero-trust-storage',
          createNamespace: false,
          wait: true,
          timeout: '6m',
          domain: 'vault.example.com',
          set: {
            'server.dataStorage.storageClass': 'openebs-hostpath',
            'server.dataStorage.size': '10Gi',
          },
        },
      ],
    },
    {
      id: '30-network-isolation',
      name: 'Zero-Trust NetworkPolicies',
      description: 'Enforce default-deny ingress and strict mTLS authorization rules across storage workloads.',
      mode: 'series',
      steps: [
        {
          id: 'storage-netpols',
          name: 'Strict Network Isolation Policies',
          chart: 'network-policies',
          releaseName: 'storage-isolation',
          namespace: 'zero-trust-storage',
          createNamespace: false,
          wait: true,
          timeout: '4m',
        },
      ],
    },
  ],
};

/**
 * 6. Home Lab Setup Blueprint
 * KitchenOwl + Jellyfin + HomeAssistant + Nextcloud + OpenProject + Frigate NVR
 */
export const BLUEPRINT_HOMELAB: WafflePipeline = {
  apiVersion: 'waffle.dev/v1',
  kind: 'WafflePipeline',
  metadata: {
    name: 'blueprint-homelab',
    version: '1.0.0',
    description: 'Ultimate Home Lab & Smart Home stack bundling HomeAssistant, Jellyfin Media, Frigate AI NVR, Nextcloud, KitchenOwl, and OpenProject on OpenEBS storage.',
    authors: [
      { name: 'Vigilant Octo Waffle Community' },
    ],
    tags: ['homelab', 'homeassistant', 'jellyfin', 'frigate', 'nextcloud', 'kitchenowl', 'openproject', 'openebs'],
  },
  settings: {
    defaultNamespace: 'homelab',
    defaultStorageClass: 'openebs-hostpath',
    defaultClusterIssuer: 'letsencrypt-prod',
    globalTimeout: '30m',
    rollbackOnFailure: false,
  },
  preflight: {
    storage: {
      requireStorageClass: 'openebs-hostpath',
      autoInstallOpenEBS: true,
    },
  },
  stages: [
    {
      id: '00-storage-foundation',
      name: 'High-Performance Local Storage',
      description: 'Provision OpenEBS Dynamic LocalPV for high-throughput NVR video streams and media libraries.',
      mode: 'series',
      steps: [
        {
          id: 'openebs',
          name: 'OpenEBS LocalPV Provisioner',
          chart: 'openebs',
          releaseName: 'openebs',
          namespace: 'openebs',
          createNamespace: true,
          wait: true,
          timeout: '5m',
        },
      ],
    },
    {
      id: '10-message-bus',
      name: 'IoT Event Bus & State Cache',
      description: 'Deploy Mosquitto MQTT broker and Redis for instant sensor telemetry and device state.',
      mode: 'parallel',
      steps: [
        {
          id: 'mosquitto',
          name: 'Eclipse Mosquitto MQTT',
          chart: 'mosquitto',
          releaseName: 'mosquitto',
          namespace: 'homelab',
          createNamespace: true,
          wait: true,
          timeout: '5m',
        },
        {
          id: 'redis',
          name: 'Redis Cache',
          chart: 'redis',
          releaseName: 'homelab-redis',
          namespace: 'homelab',
          createNamespace: true,
          wait: true,
          timeout: '5m',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
          },
        },
      ],
    },
    {
      id: '20-home-automation',
      name: 'Home Automation Core',
      description: 'Deploy Home Assistant Core with device gateway drivers and zigbee integration.',
      mode: 'series',
      steps: [
        {
          id: 'homeassistant',
          name: 'Home Assistant Core',
          chart: 'homeassistant',
          releaseName: 'homeassistant',
          namespace: 'homelab',
          createNamespace: false,
          wait: true,
          timeout: '8m',
          domain: 'home.example.com',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '20Gi',
            'ingress.host': 'home.example.com',
          },
        },
      ],
    },
    {
      id: '30-media-and-vision',
      name: 'Media Server & AI Vision NVR',
      description: 'Deploy Jellyfin 4K transcoding media server and Frigate NVR with real-time AI object detection.',
      mode: 'parallel',
      steps: [
        {
          id: 'jellyfin',
          name: 'Jellyfin Media Server',
          chart: 'jellyfin',
          releaseName: 'jellyfin',
          namespace: 'homelab',
          wait: true,
          timeout: '8m',
          domain: 'media.example.com',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '100Gi',
            'ingress.host': 'media.example.com',
          },
        },
        {
          id: 'frigate',
          name: 'Frigate AI NVR Camera System',
          chart: 'frigate',
          releaseName: 'frigate',
          namespace: 'homelab',
          wait: true,
          timeout: '8m',
          domain: 'nvr.example.com',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '100Gi',
            'ingress.host': 'nvr.example.com',
          },
        },
      ],
    },
    {
      id: '40-productivity-suite',
      name: 'Productivity & Meal Management Suite',
      description: 'Deploy Nextcloud file cloud, OpenProject project management, and KitchenOwl smart recipe planner.',
      mode: 'parallel',
      steps: [
        {
          id: 'nextcloud',
          name: 'Nextcloud Hub',
          chart: 'nextcloud',
          releaseName: 'nextcloud',
          namespace: 'homelab',
          wait: true,
          timeout: '10m',
          domain: 'cloud.example.com',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'persistence.size': '50Gi',
            'ingress.host': 'cloud.example.com',
          },
        },
        {
          id: 'openproject',
          name: 'OpenProject Collaboration',
          chart: 'openproject',
          releaseName: 'openproject',
          namespace: 'homelab',
          wait: true,
          timeout: '10m',
          domain: 'projects.example.com',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'ingress.host': 'projects.example.com',
          },
        },
        {
          id: 'kitchenowl',
          name: 'KitchenOwl Smart Grocery & Meal Planner',
          chart: 'kitchenowl',
          releaseName: 'kitchenowl',
          namespace: 'homelab',
          wait: true,
          timeout: '6m',
          domain: 'kitchen.example.com',
          set: {
            'persistence.storageClass': 'openebs-hostpath',
            'ingress.host': 'kitchen.example.com',
          },
        },
      ],
    },
  ],
};

/**
 * Built-in open-source blueprints catalog
 */
export const BUILTIN_BLUEPRINTS: WafflePipeline[] = [
  BLUEPRINT_NEXTJS_SUPABASE,
  BLUEPRINT_PYTHON_MONGODB,
  BLUEPRINT_JUPYTER_CASSANDRA,
  BLUEPRINT_KCTF,
  BLUEPRINT_ZERO_TRUST_STORAGE,
  BLUEPRINT_HOMELAB,
];

/**
 * Returns all built-in community blueprints
 */
export function getBuiltinBlueprints(): WafflePipeline[] {
  return BUILTIN_BLUEPRINTS;
}

/**
 * Finds a built-in blueprint by its unique pipeline name
 */
export function getBlueprintById(id: string): WafflePipeline | undefined {
  return BUILTIN_BLUEPRINTS.find(
    (b) => b.metadata.name === id || b.metadata.name.replace('blueprint-', '') === id
  );
}
