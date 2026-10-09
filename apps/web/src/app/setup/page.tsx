'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTerminal } from '@/context/TerminalContext';
import { soundFx } from '@/lib/audio';
import { apiErrorMessage } from '@/lib/envelope';
import {
  CheckCircle2,
  Circle,
  Server,
  Network,
  HardDrive,
  ShieldCheck,
  LayoutTemplate,
  ChevronRight,
  Play,
  ArrowRight
} from 'lucide-react';

const steps = [
  { id: 'create', title: 'Create Cluster', icon: Server, description: 'Initialize the base Kubernetes platform (k3d/k3s).' },
  { id: 'nodes', title: 'Join Nodes', icon: Network, description: 'Connect agent nodes to the control plane.' },
  { id: 'storage', title: 'Bring Up Storage', icon: HardDrive, description: 'Deploy OpenEBS or LocalPV for persistent volumes.' },
  { id: 'up', title: 'Provision Basics', icon: ShieldCheck, description: 'Deploy core components like cert-manager and ingress.' },
  { id: 'waffle', title: 'Custom Waffle', icon: LayoutTemplate, description: 'Deploy applications and custom blueprints.' },
];

export default function SetupWizard() {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { openTerminal } = useTerminal();
  const router = useRouter();

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex(currentStepIndex + 1);
      setMessage(null);
    } else {
      localStorage.setItem('vow-setup-skipped', 'true'); router.push('/');
    }
  };

  const handleAction = async (stepId: string) => {
    soundFx.playClick();
    setActionLoading(true);
    setMessage(null);
    try {
      let res;
      let title = '';

      if (stepId === 'create') {
        title = 'Cluster Creation';
        res = await fetch('/api/cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'start' }),
        });
      } else if (stepId === 'nodes') {
        title = 'Scaling/Joining Nodes';
        // In local mode, we can just scale k3d
        res = await fetch('/api/cluster/nodes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'scale_k3d', delta: 1 }),
        });
      } else if (stepId === 'storage') {
        title = 'Storage Configuration';
        res = await fetch('/api/storage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'configure-openebs' }),
        });
      } else if (stepId === 'up') {
        title = 'Core Provisioning (up.sh)';
        res = await fetch('/api/cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'up' }),
        });
      } else if (stepId === 'waffle') {
        // Just redirect to waffle studio or run default waffle?
        // Let's redirect to /waffle where they can choose what to run.
        router.push('/waffle');
        return;
      }

      if (!res) throw new Error('No response');
      const data = await res.json();
      if (data.success || res.ok) {
        soundFx.playSuccess();
        setMessage(`Action completed or started (Task ID: ${data.taskId || 'none'})`);
        if (data.taskId) {
          openTerminal(data.taskId, title);
        }
      } else {
        soundFx.playError();
        setMessage(`Failed: ${apiErrorMessage(data, 'Unknown error')}`);
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 text-slate-200">
      <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row">
        
        {/* Sidebar */}
        <div className="w-full md:w-1/3 bg-slate-950/50 p-8 border-r border-slate-800">
          <h2 className="text-xl font-bold text-white mb-8 bg-clip-text text-transparent bg-gradient-to-r from-sky-400 to-indigo-400">
            Cluster Initialization
          </h2>
          <div className="space-y-6">
            {steps.map((step, idx) => {
              const isActive = idx === currentStepIndex;
              const isPast = idx < currentStepIndex;
              const Icon = step.icon;
              return (
                <div key={step.id} className={`flex items-start space-x-3 transition-colors ${isActive ? 'opacity-100' : isPast ? 'opacity-50' : 'opacity-30'}`}>
                  <div className="mt-1">
                    {isPast ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <Circle className={`w-5 h-5 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />}
                  </div>
                  <div>
                    <h3 className={`font-semibold ${isActive ? 'text-white' : 'text-slate-300'}`}>{step.title}</h3>
                    <p className="text-xs text-slate-400 mt-1">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="w-full md:w-2/3 p-8 flex flex-col justify-between min-h-[400px]">
          <div>
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-sky-900/30 rounded-xl text-sky-400 border border-sky-800/50">
                {(() => {
                   const Icon = steps[currentStepIndex].icon;
                   return <Icon className="w-8 h-8" />;
                })()}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{steps[currentStepIndex].title}</h1>
                <p className="text-sm text-slate-400">{steps[currentStepIndex].description}</p>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 text-sm text-slate-300 mb-6">
              {currentStepIndex === 0 && (
                <p>Click below to create the initial cluster plane. This will provision the master nodes and set up the local container registry.</p>
              )}
              {currentStepIndex === 1 && (
                <p>Provision additional nodes and join them to the cluster to increase capacity. For local environments, this scales the node count.</p>
              )}
              {currentStepIndex === 2 && (
                <p>Set up the cluster storage fabric (e.g. OpenEBS or Local Path Provisioner) to handle persistent volumes across your nodes.</p>
              )}
              {currentStepIndex === 3 && (
                <p>Run the <code>up.sh</code> script equivalent. This installs core ecosystem components like cert-manager, ingress controllers, and orchestrator hooks.</p>
              )}
              {currentStepIndex === 4 && (
                <p>Navigate to the Custom Waffle UI to deploy application blueprints, data pipelines, and other workloads.</p>
              )}

              {message && (
                <div className="mt-4 p-3 bg-slate-900 border border-slate-700 rounded text-sky-300 font-mono text-xs">
                  {message}
                </div>
              )}
            </div>
            
            <button
              onClick={() => handleAction(steps[currentStepIndex].id)}
              disabled={actionLoading}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-medium flex items-center space-x-2 transition-colors disabled:opacity-50"
            >
              {actionLoading ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-4 h-4" />}
              <span>{steps[currentStepIndex].id === 'waffle' ? 'Go to Waffle Studio' : `Execute ${steps[currentStepIndex].title}`}</span>
            </button>
          </div>

          <div className="flex justify-between items-center mt-8 pt-6 border-t border-slate-800/50">
            <button
              onClick={() => {
                if (currentStepIndex > 0) {
                  setCurrentStepIndex(currentStepIndex - 1);
                  setMessage(null);
                }
              }}
              disabled={currentStepIndex === 0 || actionLoading}
              className="text-sm text-slate-400 hover:text-white transition-colors disabled:opacity-30"
            >
              Back
            </button>
            <button
              onClick={() => { localStorage.setItem('vow-setup-skipped', 'true'); router.push('/'); }}
              className="text-sm text-slate-400 hover:text-white transition-colors absolute bottom-6 right-6"
            >
              Skip Wizard
            </button>
            <button
              onClick={handleNext}
              disabled={actionLoading}
              className="text-sm font-medium text-white flex items-center space-x-1 hover:text-sky-400 transition-colors"
            >
              <span>{currentStepIndex === steps.length - 1 ? 'Finish & Go to Dashboard' : 'Next Step'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
