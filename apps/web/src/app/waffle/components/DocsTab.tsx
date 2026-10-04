'use client';

import type { WafflePageState } from '../useWafflePage';

export default function DocsTab({ s }: { s: WafflePageState }) {
  return (
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-6 max-w-4xl mx-auto">
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Waffle Meta-Package Guide & Specification</h2>
              <p className="text-xs text-slate-400">
                How to author, package, test, and host multi-chart Waffle pipelines for enterprise cluster deployments
              </p>
            </div>

            <div className="prose prose-invert prose-xs max-w-none space-y-4">
              <h3 className="text-sm font-bold text-cyan-400">1. Anatomy of a waffle.yaml</h3>
              <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs font-mono overflow-x-auto text-slate-300">
{`apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: my-datacenter-stack
  version: 1.0.0
settings:
  defaultNamespace: default
  defaultStorageClass: openebs-hostpath
stages:
  - id: 00-storage
    name: "Distributed Storage Fabric"
    mode: series
    steps:
      - id: openebs
        name: "OpenEBS Dynamic LocalPV"
        chart: ./openebs
  - id: 10-applications
    name: "Application Services"
    mode: parallel
    dependsOn: [00-storage]
    steps:
      - id: app
        chart: ./app
        domain: portal.example.com`}
              </pre>

              <h3 className="text-sm font-bold text-cyan-400">2. Remote Git Hosting</h3>
              <p className="text-xs text-slate-300">
                You can host your Waffle pipelines in any public or private Git repository (GitHub, GitLab, Gitea).
                Simply register the Git clone URL in the Studio, and Vigilant Octo Waffle will clone, validate, and execute it.
              </p>

              <h3 className="text-sm font-bold text-cyan-400">3. Storage Fabric Standardization</h3>
              <p className="text-xs text-slate-300">
                All persistent volume claims throughout the ecosystem utilize OpenEBS Dynamic LocalPV (<code className="text-emerald-400">openebs-hostpath</code>).
                When a waffle pipeline specifies OpenEBS, the preflight engine verifies the StorageClass and automatically provisions the engine if not present.
              </p>
            </div>
          </div>
  );
}
