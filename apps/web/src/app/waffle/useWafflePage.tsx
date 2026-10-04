'use client';

import { useState, useEffect, useRef } from 'react';
import { apiErrorMessage } from '@/lib/envelope';

export interface WafflePipelineMetadata {
  name: string;
  version?: string;
  description?: string;
  tags?: string[];
}

export interface WaffleBuildTarget {
  name: string;
  context: string;
  git?: string | { repo: string; branch?: string };
  dockerfile?: string;
  image: string;
  tag?: string;
}

export interface WaffleBuildsConfig {
  registry?: string;
  targets?: WaffleBuildTarget[];
}

export interface WaffleStep {
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

export interface WaffleStage {
  id: string;
  name: string;
  description?: string;
  mode?: 'series' | 'parallel';
  dependsOn?: string[];
  steps: WaffleStep[];
}

export interface WafflePipeline {
  apiVersion?: string;
  kind?: string;
  metadata: WafflePipelineMetadata;
  builds?: WaffleBuildsConfig;
  stages: WaffleStage[];
}

export interface WaffleSource {
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

export interface WaffleBlueprintSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  stagesCount: number;
  stepsCount: number;
  pipeline: WafflePipeline;
}

export interface WaffleStepProgress {
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

export interface WaffleStageProgress {
  stageId: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  mode: 'series' | 'parallel';
  steps: Record<string, WaffleStepProgress>;
}

export interface WaffleRunProgress {
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

export function useWafflePage() {
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

    eventSource.addEventListener('pipeline_log', (e: any) => {
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
        setLiveLogs((prev) => [...prev, `[ERROR] ${apiErrorMessage(data)}`]);
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
        setLiveLogs((prev) => [...prev, `[ERROR] ${apiErrorMessage(data)}`]);
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
        setFormError(apiErrorMessage(data, 'Failed to add source'));
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
  return {
    activeTab,
    setActiveTab,
    sources,
    setSources,
    blueprints,
    setBlueprints,
    selectedSourceId,
    setSelectedSourceId,
    selectedBlueprintId,
    setSelectedBlueprintId,
    currentPipeline,
    setCurrentPipeline,
    activeRun,
    setActiveRun,
    runHistory,
    setRunHistory,
    loading,
    setLoading,
    executing,
    setExecuting,
    dryRunMode,
    setDryRunMode,
    terminalOpen,
    setTerminalOpen,
    liveLogs,
    setLiveLogs,
    terminalEndRef,
    showAddModal,
    setShowAddModal,
    newSourceType,
    setNewSourceType,
    newSourcePath,
    setNewSourcePath,
    newSourceName,
    setNewSourceName,
    newSourceBranch,
    setNewSourceBranch,
    addingSource,
    setAddingSource,
    formError,
    setFormError,
    showCelebration,
    setShowCelebration,
    canvasRef,
    fetchData,
    loadSourcePipeline,
    loadBlueprintPipeline,
    handleRunPipeline,
    handleBuildImages,
    handleAbort,
    handleAddSource,
    handleSyncSource,
    handleRemoveSource,
    getStepStatusBadge,
    activeRunProgressPct,
  };
}

export type WafflePageState = ReturnType<typeof useWafflePage>;
