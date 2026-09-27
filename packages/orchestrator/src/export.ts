import { APP_CATALOG } from './registry.js';

export interface BlueprintOptions {
  provider: 'aws' | 'gcp' | 'azure' | 'baremetal';
  clusterName?: string;
  domain?: string;
  enabledAppIds: string[];
}

export interface BlueprintPackage {
  provider: string;
  clusterName: string;
  files: { filename: string; content: string }[];
  summary: string;
}

export function generateProductionBlueprint(options: BlueprintOptions): BlueprintPackage {
  const clusterName = options.clusterName || 'vow-production-cluster';
  const domain = options.domain || 'deploycoop.com';
  const provider = options.provider;

  const catalogMap = new Map(APP_CATALOG.map((a) => [a.id, a]));
  const enabledApps = options.enabledAppIds
    .map((id) => catalogMap.get(id))
    .filter(Boolean);

  // 1. main.tf
  let providerBlock = '';
  let clusterBlock = '';

  if (provider === 'aws') {
    providerBlock = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.26"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
`;
    clusterBlock = `module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = "1.31"

  cluster_endpoint_public_access = true

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    standard = {
      instance_types = ["m6i.xlarge"]
      min_size     = 2
      max_size     = 5
      desired_size = 3
    }
  }
}
`;
  } else if (provider === 'gcp') {
    providerBlock = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }
}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
`;
    clusterBlock = `resource "google_container_cluster" "primary" {
  name     = var.cluster_name
  location = var.gcp_region

  remove_default_node_pool = true
  initial_node_count       = 1
}

resource "google_container_node_pool" "primary_nodes" {
  name       = "\${var.cluster_name}-node-pool"
  location   = var.gcp_region
  cluster    = google_container_cluster.primary.name
  node_count = 3

  node_config {
    machine_type = "e2-standard-4"
    oauth_scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }
}
`;
  } else {
    // Azure / Baremetal
    providerBlock = `terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.90"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
  }
}

provider "azurerm" {
  features {}
}
`;
    clusterBlock = `resource "azurerm_kubernetes_cluster" "aks" {
  name                = var.cluster_name
  location            = var.azure_region
  resource_group_name = var.resource_group_name
  dns_prefix          = "\${var.cluster_name}-dns"

  default_node_pool {
    name       = "default"
    node_count = 3
    vm_size    = "Standard_D4s_v5"
  }

  identity {
    type = "SystemAssigned"
  }
}
`;
  }

  // 2. helm_releases.tf
  let helmReleases = `# Helm Releases generated from active Vigilant Octo Waffle configuration\n\n`;

  // Always include ArgoCD
  helmReleases += `resource "helm_release" "argocd" {
  name             = "argo-cd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = "5.51.6"
  namespace        = "argocd"
  create_namespace = true

  set {
    name  = "server.service.type"
    value = "ClusterIP"
  }
}

resource "helm_release" "cert_manager" {
  name             = "cert-manager"
  repository       = "https://charts.jetstack.io"
  chart            = "cert-manager"
  version          = "v1.14.2"
  namespace        = "cert-manager"
  create_namespace = true

  set {
    name  = "installCRDs"
    value = "true"
  }
}
\n`;

  for (const app of enabledApps) {
    if (!app || app.id === 'argocd' || app.id === 'certmanager') continue;
    helmReleases += `resource "helm_release" "${app.id.replace(/-/g, '_')}" {
  name             = "${app.id}"
  namespace        = "${app.id}"
  create_namespace = true
  chart            = "${app.id}"
  repository       = "https://charts.bitnami.com/bitnami"

  depends_on = [helm_release.argocd, helm_release.cert_manager]
}
\n`;
  }

  // 3. variables.tf
  const variablesContent = `variable "cluster_name" {
  type        = string
  default     = "${clusterName}"
  description = "Production Kubernetes cluster name"
}

variable "domain_name" {
  type        = string
  default     = "${domain}"
  description = "Base domain name for ingresses"
}

variable "aws_region" {
  type        = string
  default     = "us-east-1"
}

variable "gcp_project_id" {
  type        = string
  default     = "my-gcp-project"
}

variable "gcp_region" {
  type        = string
  default     = "us-central1"
}

variable "azure_region" {
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  type        = string
  default     = "vow-production-rg"
}
`;

  return {
    provider,
    clusterName,
    summary: `Generated Terraform blueprint for ${provider.toUpperCase()} with ${enabledApps.length} cloud-native Helm workloads.`,
    files: [
      { filename: 'main.tf', content: `${providerBlock}\n${clusterBlock}` },
      { filename: 'helm_releases.tf', content: helmReleases },
      { filename: 'variables.tf', content: variablesContent },
    ],
  };
}
