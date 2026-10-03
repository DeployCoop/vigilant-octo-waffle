'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  Play,
  RotateCw,
  FolderOpen,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  Clock,
  Terminal as TerminalIcon,
  ExternalLink,
  ChevronRight,
  Shield,
  Layers,
  StopCircle,
  Plus,
  Trash2,
  RefreshCw,
  BookOpen,
  ArrowRight,
  Database,
  Cpu,
  Boxes,
  Zap,
  Check,
  X,
  FileCode,
  Hammer,
} from 'lucide-react';

interface WafflePipelineMetadata {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
}

interface WaffleBuildTarget {
  name: string;
  context: string;
  git?: string | { repo: string; branch?: string };
  dockerfile?: string;
  image: string;
  tag?: string;
}

interface WaffleBuildsConfig {
  registry?: string;
  targets?: WaffleBuildTarget[];
}

interface WaffleStep {
  id: string;
  name: string;
  chart: string;
  releaseName?: string;
  namespace?: string;
  timeout?: string;
  domain?: string;
  set?: Record<string, any>;
  healthCheck?: {
    type?: string;
    name?: string;
  };
}

interface WaffleStage {
  id: string;
  name: string;
  description?: string;
  mode?: 'series' | 'parallel';
  dependsOn?: string[];
  steps: WaffleStep[];
}

interface WafflePipeline {
  apiVersion?: string;
  kind?: string;
  metadata: WafflePipelineMetadata;
  builds?: WaffleBuildsConfig;
  stages: WaffleStage[];
}

interface WaffleSource {
  id: string;
  name: string;
  type: 'local' | 'git' | 'blueprint';
  pathOrUrl: string;
  branch?: string;
  currentSha?: string;
  lastSynced?: string;
  status: 'ready' | 'syncing' | 'error' | 'unreachable';
  errorMessage?: string;
  pipelineMetadata?: WafflePipelineMetadata;
  chartCount: number;
  stagesCount: number;
  stepsCount: number;
  localPath: string;
}

interface WaffleBlueprintSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  stagesCount: number;
  stepsCount: number;
  pipeline: WafflePipeline;
}

interface WaffleStepProgress {
  stepId: string;
  name: string;
  status: 'pending' | 'running' | 'verifying' | 'completed' | 'failed' | 'skipped';
  chart: string;
  namespace: string;
  releaseName: string;
  domain?: string;
  durationMs?: number;
  error?: string;
  logs: string[];
}

interface WaffleStageProgress {
  stageId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  mode: 'series' | 'parallel';
  steps: Record<string, WaffleStepProgress>;
}

interface WaffleRunProgress {
  runId: string;
  sourceId: string;
  pipelineName: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  stages: Record<string, WaffleStageProgress>;
  startedAt: string;
  finishedAt?: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  activeStepId?: string;
  activeStageId?: string;
  currentLogLine?: string;
  error?: string;
  deployedDomains: Array<{ name: string; domain: string; url: string }>;
  dryRun?: boolean;
}

export default function WaffleStudioPage() {
  const [activeTab, setActiveTab] = useState<'canvas' | 'sources' | 'blueprints' | 'history' | 'docs'>('canvas');
  const [sources, setSources] = useState<WaffleSource[]>([]);
  const [blueprints, setBlueprints] = useState<WaffleBlueprintSummary[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  const [selectedBlueprintId, setSelectedBlueprintId] = useState<string>('');
  const [currentPipeline, setCurrentPipeline] = useState<WafflePipeline | null>(null);
  const [activeRun, setActiveRun] = useState<WaffleRunProgress | null>(null);
  const [runHistory, setRunHistory] = useState<WaffleRunProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [dryRunMode, setDryRunMode] = useState(false);

  // Terminal & Logs
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Modals & Forms
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSourceType, setNewSourceType] = useState<'local' | 'git'>('local');
  const [newSourcePath, setNewSourcePath] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceBranch, setNewSourceBranch] = useState('main');
  const [addingSource, setAddingSource] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Celebration
  const [showCelebration, setShowCelebration] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Fetch initial studio data
  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/waffle');
      const data = await res.json();
      if (res.ok) {
        setSources(data.sources || []);
        setBlueprints(data.blueprints || []);
        setRunHistory(data.history || []);
        if (data.activeRun) {
          setActiveRun(data.activeRun);
          setExecuting(data.activeRun.status === 'running');
        }

        // Set default selection if none chosen
        if (!selectedSourceId && !selectedBlueprintId) {
          if (data.sources && data.sources.length > 0) {
            setSelectedSourceId(data.sources[0].id);
            loadSourcePipeline(data.sources[0].id);
          } else if (data.blueprints && data.blueprints.length > 0) {
            setSelectedBlueprintId(data.blueprints[0].id);
            setCurrentPipeline(data.blueprints[0].pipeline);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load waffle studio data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSourcePipeline = async (id: string) => {
    try {
      const res = await fetch(`/api/waffle?sourceId=${encodeURIComponent(id)}`);
      if (res.ok) {
        const data = await res.json();
        setCurrentPipeline(data.pipeline);
      }
    } catch (err) {
      console.error('Failed to load pipeline for source:', err);
    }
  };

  const loadBlueprintPipeline = async (id: string) => {
    const bp = blueprints.find((b) => b.id === id);
    if (bp) {
      setCurrentPipeline(bp.pipeline);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // SSE event streaming listener
  useEffect(() => {
    const eventSource = new EventSource('/api/waffle/stream');

    eventSource.addEventListener('init', (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.activeRun) {
          setActiveRun(payload.activeRun);
          setExecuting(payload.activeRun.status === 'running');
        }
      } catch {}
    });

    eventSource.addEventListener('progress', (e: any) => {
      try {
        const payload = JSON.parse(e.data) as WaffleRunProgress;
        setActiveRun(payload);
        setExecuting(payload.status === 'running');
        if (payload.status === 'completed') {
          setShowCelebration(true);
        }
      } catch {}
    });

    eventSource.addEventListener('step_log', (e: any) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.line) {
          setLiveLogs((prev) => [...prev.slice(-300), payload.line]);
        }
      } catch {}
    });

    eventSource.addEventListener('finish', (e: any) => {
      try {
        const payload = JSON.parse(e.data) as WaffleRunProgress;
        setActiveRun(payload);
        setExecuting(false);
        if (payload.status === 'completed') {
          setShowCelebration(true);
        }
        // Refresh history
        fetch('/api/waffle')
          .then((r) => r.json())
          .then((d) => setRunHistory(d.history || []));
      } catch {}
    });

    return () => {
      eventSource.close();
    };
  }, []);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalEndRef.current && terminalOpen) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveLogs, terminalOpen]);

  // Particle Confetti Effect
  useEffect(() => {
    if (!showCelebration || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      rotation: number;
      rotSpeed: number;
    }> = [];

    const colors = ['#06b6d4', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#3b82f6'];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 3,
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.7) * 16,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        rotation: Math.random() * 360,
        rotSpeed: (Math.random() - 0.5) * 8,
      });
    }

    let animationFrameId: number;
    let ticks = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ticks++;

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.3; // gravity
        p.rotation += p.rotSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      if (ticks < 220) {
        animationFrameId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    render();

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [showCelebration]);

  // Execute Pipeline Action
  const handleRunPipeline = async (dryRun: boolean = false) => {
    try {
      setExecuting(true);
      setLiveLogs([`[STUDIO] Launching Waffle execution run (${dryRun ? 'DRY-RUN' : 'LIVE'})...`]);
      setTerminalOpen(true);

      const body: any = { dryRun };
      if (selectedSourceId) {
        body.sourceId = selectedSourceId;
      } else if (selectedBlueprintId) {
        body.blueprintId = selectedBlueprintId;
      }

      const res = await fetch('/api/waffle/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setLiveLogs((prev) => [...prev, `[ERROR] ${data.error}`]);
        setExecuting(false);
      } else {
        setActiveRun(data.run);
      }
    } catch (err: any) {
      setLiveLogs((prev) => [...prev, `[FATAL] ${err.message}`]);
      setExecuting(false);
    }
  };

  // Rebuild Container Images Action
  const handleBuildImages = async (dryRun: boolean = false) => {
    try {
      setExecuting(true);
      setLiveLogs([`[STUDIO] Triggering automated rebuild of container images (${dryRun ? 'DRY-RUN' : 'LIVE'})...`]);
      setTerminalOpen(true);

      const body: any = { dryRun, buildOnly: true };
      if (selectedSourceId) {
        body.sourceId = selectedSourceId;
      } else if (selectedBlueprintId) {
        body.blueprintId = selectedBlueprintId;
      }

      const res = await fetch('/api/waffle/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) {
        setLiveLogs((prev) => [...prev, `[ERROR] ${data.error}`]);
        setExecuting(false);
      } else {
        setActiveRun(data.run);
      }
    } catch (err: any) {
      setLiveLogs((prev) => [...prev, `[FATAL] ${err.message}`]);
      setExecuting(false);
    }
  };

  // Abort Pipeline Action
  const handleAbort = async () => {
    try {
      await fetch('/api/waffle/abort', { method: 'POST' });
      setLiveLogs((prev) => [...prev, '[STUDIO] Abort signal dispatched. Halting execution...']);
    } catch (err: any) {
      console.error('Failed to abort:', err);
    }
  };

  // Add Source Action
  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setAddingSource(true);

    try {
      const res = await fetch('/api/waffle/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newSourceType,
          pathOrUrl: newSourcePath.trim(),
          name: newSourceName.trim() || undefined,
          branch: newSourceType === 'git' ? newSourceBranch.trim() : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to add source');
      } else {
        setShowAddModal(false);
        setNewSourcePath('');
        setNewSourceName('');
        await fetchData();
        setSelectedSourceId(data.source.id);
        setSelectedBlueprintId('');
        loadSourcePipeline(data.source.id);
        setActiveTab('canvas');
      }
    } catch (err: any) {
      setFormError(err.message || 'Network error');
    } finally {
      setAddingSource(false);
    }
  };

  // Sync Source Action
  const handleSyncSource = async (id: string) => {
    try {
      const res = await fetch('/api/waffle/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Sync failed:', err);
    }
  };

  // Remove Source Action
  const handleRemoveSource = async (id: string) => {
    if (!confirm('Are you sure you want to remove this tracked Waffle source?')) return;
    try {
      const res = await fetch(`/api/waffle/sources?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('Failed to remove source:', err);
    }
  };

  const getStepStatusBadge = (status?: string) => {
    switch (status) {
      case 'completed':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">✔ Ready</span>;
      case 'running':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 animate-pulse">⚡ Applying</span>;
      case 'verifying':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/40 animate-pulse">🔍 Probing</span>;
      case 'failed':
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">✖ Failed</span>;
      default:
        return <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">⏳ Pending</span>;
    }
  };

  const activeRunProgressPct = activeRun && activeRun.totalSteps > 0
    ? Math.round((activeRun.completedSteps / activeRun.totalSteps) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative pb-32">
      {/* Particle Canvas Overlay for Victory Celebration */}
      <canvas
        ref={canvasRef}
        className={`fixed inset-0 pointer-events-none z-50 transition-opacity duration-500 ${
          showCelebration ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Top Banner / Hero Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-indigo-500 p-0.5 shadow-lg shadow-cyan-500/20 flex items-center justify-center">
              <span className="text-2xl">🧇</span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Waffle Meta-Package Studio
                  <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                    waffle.dev/v1
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Autonomous multi-stage datacenter deployment runner & OpenEBS LocalPV storage fabric
              </p>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleRunPipeline(false)}
              disabled={executing || !currentPipeline}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-md transition-all ${
                executing
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/20'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{executing ? 'Waffle Running...' : 'Deploy Waffle'}</span>
            </button>

            <button
              onClick={() => handleRunPipeline(true)}
              disabled={executing || !currentPipeline}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/40 text-purple-300 transition-colors"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Simulate (Dry-Run)</span>
            </button>

            <button
              onClick={() => handleBuildImages(false)}
              disabled={executing || !currentPipeline?.builds?.targets?.length}
              title={
                !currentPipeline?.builds?.targets?.length
                  ? 'No build targets configured in this pipeline'
                  : `Rebuild all ${currentPipeline.builds.targets.length} container images`
              }
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                !currentPipeline?.builds?.targets?.length || executing
                  ? 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                  : 'border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 text-amber-300'
              }`}
            >
              <Hammer className="w-3.5 h-3.5" />
              <span>
                Rebuild Images{currentPipeline?.builds?.targets?.length ? ` (${currentPipeline.builds.targets.length})` : ''}
              </span>
            </button>

            {executing && (
              <button
                onClick={handleAbort}
                className="flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all animate-pulse"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Abort</span>
              </button>
            )}

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Track Target</span>
            </button>

            <button
              onClick={fetchData}
              title="Refresh Sources"
              className="p-2 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Global Progress Bar (if executing) */}
        {activeRun && activeRun.status === 'running' && (
          <div className="max-w-7xl mx-auto mt-4 pt-3 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
              <span className="text-cyan-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
                Executing: <strong className="text-white">{activeRun.pipelineName}</strong>
              </span>
              <span className="text-slate-400">
                {activeRun.completedSteps} of {activeRun.totalSteps} steps completed ({activeRunProgressPct}%)
              </span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-500 transition-all duration-300"
                style={{ width: `${activeRunProgressPct}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Main Studio Viewport */}
      <main className="max-w-7xl mx-auto px-6 py-6 w-full flex-1">
        {/* Navigation Tabs & Target Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('canvas')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'canvas'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Pipeline Canvas</span>
            </button>

            <button
              onClick={() => setActiveTab('sources')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'sources'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Tracked Targets ({sources.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('blueprints')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'blueprints'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Blueprints ({blueprints.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'history'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Run History ({runHistory.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('docs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'docs'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Documentation</span>
            </button>
          </div>

          {/* Active Target Dropdown Switcher */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Target:</span>
            <select
              value={selectedSourceId ? `source:${selectedSourceId}` : `bp:${selectedBlueprintId}`}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith('source:')) {
                  const id = val.replace('source:', '');
                  setSelectedSourceId(id);
                  setSelectedBlueprintId('');
                  loadSourcePipeline(id);
                } else if (val.startsWith('bp:')) {
                  const id = val.replace('bp:', '');
                  setSelectedBlueprintId(id);
                  setSelectedSourceId('');
                  loadBlueprintPipeline(id);
                }
              }}
              className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
            >
              <optgroup label="Tracked Targets">
                {sources.map((s) => (
                  <option key={s.id} value={`source:${s.id}`}>
                    {s.name} ({s.chartCount} charts)
                  </option>
                ))}
              </optgroup>
              <optgroup label="Default Blueprints">
                {blueprints.map((b) => (
                  <option key={b.id} value={`bp:${b.id}`}>
                    {b.name} ({b.stepsCount} steps)
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* TAB 1: PIPELINE CANVAS */}
        {activeTab === 'canvas' && (
          <div className="space-y-6">
            {/* Pipeline Header Card */}
            {currentPipeline ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-40 bg-gradient-to-bl from-cyan-500/10 via-indigo-500/5 to-transparent pointer-events-none" />
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-3 mb-1">
                      <h2 className="text-lg font-bold text-white tracking-wide">
                        {currentPipeline.metadata.name}
                      </h2>
                      <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300 border border-slate-700">
                        v{currentPipeline.metadata.version || '1.0.0'}
                      </span>
                      {selectedBlueprintId && (
                        <span className="text-xs px-2 py-0.5 rounded font-semibold bg-purple-950/80 border border-purple-500/40 text-purple-300">
                          Community Blueprint
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
                      {currentPipeline.metadata.description || 'No description provided.'}
                    </p>
                  </div>

                  <div className="flex items-center space-x-4 shrink-0 text-xs">
                    <div className="px-3 py-1.5 bg-slate-950/80 rounded-lg border border-slate-800">
                      <span className="text-slate-400">Stages: </span>
                      <strong className="text-cyan-400">{currentPipeline.stages.length}</strong>
                    </div>
                    <div className="px-3 py-1.5 bg-slate-950/80 rounded-lg border border-slate-800">
                      <span className="text-slate-400">Total Charts: </span>
                      <strong className="text-cyan-400">
                        {currentPipeline.stages.reduce((acc, s) => acc + s.steps.length, 0)}
                      </strong>
                    </div>
                    <div className="px-3 py-1.5 bg-slate-950/80 rounded-lg border border-slate-800">
                      <span className="text-slate-400">StorageClass: </span>
                      <strong className="text-emerald-400">openebs-hostpath</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
                <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No active pipeline loaded. Select a target or blueprint above.</p>
              </div>
            )}

            {/* Interactive Animated Pipeline Stage Canvas */}
            {currentPipeline && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    Stage Execution DAG (Dependency Order)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    OpenEBS LocalPV Pre-flight Active
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-6 relative">
                  {currentPipeline.stages.map((stage, sIdx) => {
                    const stageProg = activeRun?.stages[stage.id];
                    const stageStatus = stageProg?.status || 'pending';

                    return (
                      <div
                        key={stage.id}
                        className={`rounded-2xl border transition-all duration-300 relative overflow-hidden ${
                          stageStatus === 'running'
                            ? 'bg-slate-900/90 border-cyan-500/60 shadow-xl shadow-cyan-500/10'
                            : stageStatus === 'completed'
                            ? 'bg-slate-900/60 border-emerald-500/30'
                            : stageStatus === 'failed'
                            ? 'bg-slate-900/60 border-rose-500/40'
                            : 'bg-slate-900/40 border-slate-800/80'
                        }`}
                      >
                        {/* Animated Stage Header */}
                        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-2">
                          <div className="flex items-center space-x-3">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                                stageStatus === 'running'
                                  ? 'bg-cyan-500 text-slate-950 animate-pulse'
                                  : stageStatus === 'completed'
                                  ? 'bg-emerald-500 text-slate-950'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {sIdx}
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h4 className="text-sm font-bold text-white tracking-wide">
                                  {stage.name}
                                </h4>
                                <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-950 border border-slate-800 text-slate-400">
                                  {stage.id}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400">
                                {stage.description || 'Execution stage'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <span
                              className={`text-xs px-2.5 py-1 rounded-full font-mono font-semibold uppercase tracking-wider ${
                                stage.mode === 'parallel'
                                  ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30'
                                  : 'bg-slate-950 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {stage.mode === 'parallel' ? '⚡ Parallel Mode' : '➔ Series Mode'}
                            </span>
                            {getStepStatusBadge(stageStatus)}
                          </div>
                        </div>

                        {/* Step Card Grid */}
                        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {stage.steps.map((step) => {
                            const stepProg = stageProg?.steps[step.id];
                            const stepStatus = stepProg?.status || 'pending';

                            return (
                              <div
                                key={step.id}
                                className={`rounded-xl border p-4 transition-all duration-200 relative ${
                                  stepStatus === 'running'
                                    ? 'bg-slate-950 border-cyan-500 shadow-md shadow-cyan-500/20'
                                    : stepStatus === 'verifying'
                                    ? 'bg-slate-950 border-purple-500 shadow-md shadow-purple-500/20'
                                    : stepStatus === 'completed'
                                    ? 'bg-slate-950/80 border-emerald-500/40'
                                    : stepStatus === 'failed'
                                    ? 'bg-slate-950/80 border-rose-500/40'
                                    : 'bg-slate-950/50 border-slate-800/80'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="font-semibold text-xs text-white tracking-wide truncate">
                                    {step.name}
                                  </div>
                                  <div>{getStepStatusBadge(stepStatus)}</div>
                                </div>

                                <div className="space-y-1.5 text-xs text-slate-400">
                                  <div className="flex items-center justify-between">
                                    <span>Chart:</span>
                                    <code className="text-cyan-400 font-mono">{step.chart}</code>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span>Namespace:</span>
                                    <code className="text-slate-300 font-mono">{step.namespace || 'default'}</code>
                                  </div>
                                  {step.domain && (
                                    <div className="flex items-center justify-between">
                                      <span>Domain:</span>
                                      <a
                                        href={`https://${step.domain}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                                      >
                                        {step.domain}
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    </div>
                                  )}
                                  {stepProg?.durationMs && (
                                    <div className="flex items-center justify-between text-slate-500">
                                      <span>Duration:</span>
                                      <span>{(stepProg.durationMs / 1000).toFixed(1)}s</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TRACKED SOURCES */}
        {activeTab === 'sources' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Tracked Waffle Targets</h3>
                <p className="text-xs text-slate-400">
                  Supervise local folders and remote Git URLs containing waffle.yaml pipelines
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Target</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sources.map((s) => (
                <div
                  key={s.id}
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {s.type === 'git' ? (
                          <GitBranch className="w-4 h-4 text-purple-400" />
                        ) : (
                          <FolderOpen className="w-4 h-4 text-cyan-400" />
                        )}
                        <h4 className="font-bold text-sm text-white">{s.name}</h4>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-mono ${
                          s.status === 'ready'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-slate-400 break-all mb-3">
                      {s.pathOrUrl}
                    </p>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-500 block">Stages</span>
                        <strong className="text-white">{s.stagesCount || 0}</strong>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-500 block">Steps</span>
                        <strong className="text-white">{s.stepsCount || 0}</strong>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-500 block">Charts</span>
                        <strong className="text-white">{s.chartCount || 0}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                    <button
                      onClick={() => {
                        setSelectedSourceId(s.id);
                        setSelectedBlueprintId('');
                        loadSourcePipeline(s.id);
                        setActiveTab('canvas');
                      }}
                      className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    >
                      <span>Open Canvas</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleSyncSource(s.id)}
                        title="Sync / Pull Source"
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveSource(s.id)}
                        title="Delete Source"
                        className="p-1.5 rounded hover:bg-rose-900/40 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: COMMUNITY BLUEPRINTS */}
        {activeTab === 'blueprints' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-white">Pre-Packaged Community Blueprints</h3>
              <p className="text-xs text-slate-400">
                Vendor-neutral open source architectural blueprints with OpenEBS LocalPV storage pre-configured
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {blueprints.map((bp) => (
                <div
                  key={bp.id}
                  className="bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-sm text-white">{bp.name}</h4>
                      <span className="text-xs px-2 py-0.5 rounded font-mono bg-purple-950 text-purple-300 border border-purple-800">
                        {bp.stagesCount} Stages
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 line-clamp-3 mb-4 leading-relaxed">
                      {bp.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {bp.tags?.map((t) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 font-mono">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedBlueprintId(bp.id);
                      setSelectedSourceId('');
                      setCurrentPipeline(bp.pipeline);
                      setActiveTab('canvas');
                    }}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Load Blueprint</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 4: RUN HISTORY */}
        {activeTab === 'history' && (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-white">Execution Run History</h3>
              <p className="text-xs text-slate-400">
                Audited record of recent Waffle pipeline deployments and health verifications
              </p>
            </div>

            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/60">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/80 border-b border-slate-800 text-slate-400 uppercase font-mono">
                  <tr>
                    <th className="py-3 px-4">Run ID</th>
                    <th className="py-3 px-4">Pipeline</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Steps</th>
                    <th className="py-3 px-4">Started</th>
                    <th className="py-3 px-4">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {runHistory.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500">
                        No previous execution runs recorded.
                      </td>
                    </tr>
                  ) : (
                    runHistory.map((run) => (
                      <tr key={run.runId} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono text-cyan-400">{run.runId}</td>
                        <td className="py-3 px-4 font-semibold text-white">{run.pipelineName}</td>
                        <td className="py-3 px-4">{getStepStatusBadge(run.status)}</td>
                        <td className="py-3 px-4 font-mono">
                          {run.completedSteps} / {run.totalSteps}
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {new Date(run.startedAt).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-slate-400 font-mono">
                          {run.finishedAt
                            ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
                            : 'active'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 5: DOCUMENTATION */}
        {activeTab === 'docs' && (
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
        )}
      </main>

      {/* Floating Streaming Terminal Drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 border-t border-slate-800 backdrop-blur shadow-2xl transition-all duration-300 ${
          terminalOpen ? 'h-72' : 'h-10'
        }`}
      >
        <div
          onClick={() => setTerminalOpen(!terminalOpen)}
          className="h-10 px-6 flex items-center justify-between cursor-pointer border-b border-slate-800 hover:bg-slate-900/50"
        >
          <div className="flex items-center space-x-2 text-xs font-mono">
            <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-white">Live Execution Terminal</span>
            {executing && (
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping ml-1" />
            )}
            <span className="text-slate-500">({liveLogs.length} lines logged)</span>
          </div>

          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLiveLogs([]);
              }}
              className="hover:text-white"
            >
              Clear
            </button>
            <span>{terminalOpen ? '▼ Minimize' : '▲ Expand'}</span>
          </div>
        </div>

        {terminalOpen && (
          <div className="h-[calc(100%-2.5rem)] p-4 overflow-y-auto font-mono text-xs text-slate-300 space-y-1 bg-slate-950">
            {liveLogs.length === 0 ? (
              <p className="text-slate-600">Terminal ready. Output will stream here during execution.</p>
            ) : (
              liveLogs.map((line, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    line.includes('[ERROR]') || line.includes('[FATAL]')
                      ? 'text-rose-400'
                      : line.includes('[PREFLIGHT]')
                      ? 'text-purple-300'
                      : line.includes('✔') || line.includes('finished')
                      ? 'text-emerald-400'
                      : 'text-slate-300'
                  }`}
                >
                  {line}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>

      {/* Victory Celebration Modal */}
      {showCelebration && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl p-8 max-w-xl w-full text-center space-y-6 shadow-2xl shadow-emerald-500/10">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 mx-auto flex items-center justify-center text-3xl animate-bounce">
              🎉
            </div>

            <div>
              <h3 className="text-2xl font-bold text-white tracking-wide">
                Waffle Pipeline Deployed!
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                All dependency stages and health verification checks passed with 0 errors.
              </p>
            </div>

            {activeRun && activeRun.deployedDomains.length > 0 && (
              <div className="space-y-2 text-left bg-slate-950 p-4 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Active Deployed VIP Portals:
                </span>
                {activeRun.deployedDomains.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between text-xs py-1">
                    <span className="text-white font-medium">{d.name}</span>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                    >
                      {d.domain}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowCelebration(false)}
              className="px-6 py-2.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-lg shadow-emerald-500/20"
            >
              Close & View Canvas
            </button>
          </div>
        </div>
      )}

      {/* Add Target Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">Track Waffle Target</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddSource} className="space-y-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Target Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNewSourceType('local')}
                    className={`py-2 text-xs font-semibold rounded-lg border text-center ${
                      newSourceType === 'local'
                        ? 'bg-cyan-500/10 border-cyan-500/40 text-cyan-400'
                        : 'border-slate-800 text-slate-400'
                    }`}
                  >
                    Local Directory
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewSourceType('git')}
                    className={`py-2 text-xs font-semibold rounded-lg border text-center ${
                      newSourceType === 'git'
                        ? 'bg-purple-500/10 border-purple-500/40 text-purple-400'
                        : 'border-slate-800 text-slate-400'
                    }`}
                  >
                    Remote Git Repo
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  {newSourceType === 'local' ? 'Directory Path' : 'Git Clone URL'}
                </label>
                <input
                  type="text"
                  required
                  placeholder={
                    newSourceType === 'local'
                      ? '/home/thoth/billama/charts'
                      : 'https://github.com/my-org/my-waffle-repo.git'
                  }
                  value={newSourcePath}
                  onChange={(e) => setNewSourcePath(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Target Name (Optional)</label>
                <input
                  type="text"
                  placeholder="Master Ecosystem"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>

              {newSourceType === 'git' && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Git Branch</label>
                  <input
                    type="text"
                    placeholder="main"
                    value={newSourceBranch}
                    onChange={(e) => setNewSourceBranch(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500"
                  />
                </div>
              )}

              {formError && (
                <div className="p-3 rounded-lg bg-rose-950/60 border border-rose-800 text-rose-300 text-xs">
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingSource}
                  className="px-4 py-2 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50"
                >
                  {addingSource ? 'Registering...' : 'Register Target'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
