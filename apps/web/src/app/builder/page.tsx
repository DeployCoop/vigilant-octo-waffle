'use client';

import { useState, useEffect } from 'react';
import {
  Boxes,
  Play,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FolderGit2,
  FileCode,
  Terminal,
  UploadCloud,
  Layers,
} from 'lucide-react';

interface LocalImage {
  repository: string;
  tag: string;
  digest: string;
  sizeMb: number;
  created: string;
  isLocalRegistry: boolean;
}

export default function ImageBuilderPage() {
  const [images, setImages] = useState<LocalImage[]>([]);
  const [loading, setLoading] = useState(true);

  // Build form state
  const [imageName, setImageName] = useState('vigilant-octo-waffle/web');
  const [tag, setTag] = useState('v1.1.0-dev');
  const [pushLocal, setPushLocal] = useState(true);
  const [dockerfileContent, setDockerfileContent] = useState(
`FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod
COPY . .
EXPOSE 3000
CMD ["pnpm", "start"]`
  );

  const [building, setBuilding] = useState(false);
  const [buildLogs, setBuildLogs] = useState<string>('');

  const loadImages = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/builder');
      const data = await res.json();
      setImages(data.images || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadImages();
  }, []);

  const handleBuild = async () => {
    if (!imageName.trim() || !dockerfileContent.trim()) return;
    setBuilding(true);
    setBuildLogs(`[vow-builder] Starting local compilation for ${imageName}:${tag}...\n`);

    try {
      const res = await fetch('/api/builder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'build',
          imageName: imageName.trim(),
          tag: tag.trim(),
          dockerfileContent,
          pushToLocalRegistry: pushLocal,
        }),
      });
      const data = await res.json();
      setBuildLogs(data.logs || 'Build complete.');
      loadImages();
    } catch (err: any) {
      setBuildLogs((prev) => prev + `\n[error] Build failed: ${err.message}`);
    } finally {
      setBuilding(false);
    }
  };

  const templates = [
    {
      name: 'Node.js / Next.js',
      code: `FROM node:22-alpine AS runner\nWORKDIR /app\nENV NODE_ENV=production\nCOPY package.json pnpm-lock.yaml ./\nRUN npm install -g pnpm && pnpm install --prod\nCOPY . .\nEXPOSE 3000\nCMD ["pnpm", "start"]`,
    },
    {
      name: 'Python FastAPI',
      code: `FROM python:3.12-slim\nWORKDIR /app\nCOPY requirements.txt .\nRUN pip install --no-cache-dir -r requirements.txt\nCOPY . .\nEXPOSE 8000\nCMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`,
    },
    {
      name: 'Go Alpine Microservice',
      code: `FROM golang:1.24-alpine AS builder\nWORKDIR /app\nCOPY . .\nRUN go build -o server .\n\nFROM alpine:latest\nWORKDIR /root/\nCOPY --from=builder /app/server .\nEXPOSE 8080\nCMD ["./server"]`,
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Boxes className="w-6 h-6 text-sky-400" />
            <span>Local OCI Image Builder & Registry Studio</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Build container images directly in-cluster and push to local registry (localhost:5000) for instant sub-second ArgoCD deployment.
          </p>
        </div>

        <button
          onClick={loadImages}
          disabled={loading}
          className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          <span>Refresh Images</span>
        </button>
      </div>

      {/* Build Studio Panel */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
            <FileCode className="w-4 h-4 text-sky-400" />
            <span>Container Image Definition</span>
          </h2>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-500">Preset Templates:</span>
            {templates.map((tpl) => (
              <button
                key={tpl.name}
                onClick={() => setDockerfileContent(tpl.code)}
                className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2.5 py-1 rounded border border-slate-700 transition"
              >
                {tpl.name}
              </button>
            ))}
          </div>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Image Repository</label>
            <input
              type="text"
              value={imageName}
              onChange={(e) => setImageName(e.target.value)}
              placeholder="e.g. my-app or api-service"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">Image Tag</label>
            <input
              type="text"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div className="flex items-center pt-5">
            <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={pushLocal}
                onChange={(e) => setPushLocal(e.target.checked)}
                className="rounded border-slate-800 bg-slate-950 text-sky-500 focus:ring-0"
              />
              <span>Push to local cluster registry (localhost:5000)</span>
            </label>
          </div>
        </div>

        {/* Dockerfile Editor */}
        <div className="space-y-1.5">
          <label className="text-xs text-slate-400 block">Dockerfile Instructions</label>
          <textarea
            rows={7}
            value={dockerfileContent}
            onChange={(e) => setDockerfileContent(e.target.value)}
            className="w-full bg-slate-950 font-mono text-xs text-sky-300 p-3 rounded-lg border border-slate-800 focus:outline-none focus:border-sky-500 resize-y"
          />
        </div>

        <div className="flex justify-end">
          <button
            onClick={handleBuild}
            disabled={building}
            className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white px-5 py-2.5 rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm"
          >
            {building ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            <span>{building ? 'Building Image via BuildKit...' : 'Build Container Image'}</span>
          </button>
        </div>

        {/* Terminal Logs */}
        {buildLogs && (
          <div className="space-y-1.5 pt-2">
            <span className="text-xs font-semibold text-slate-400 flex items-center space-x-1.5">
              <Terminal className="w-3.5 h-3.5 text-sky-400" />
              <span>Compilation Terminal Logs</span>
            </span>
            <pre className="p-4 bg-black rounded-xl border border-slate-800 font-mono text-xs text-emerald-400 leading-relaxed overflow-x-auto max-h-56">
              {buildLogs}
            </pre>
          </div>
        )}
      </div>

      {/* Local Images Catalog Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Local Container Image Registry (localhost:5000)
          </h3>
          <span className="text-xs text-slate-500">{images.length} Images</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="p-2.5">Repository</th>
                <th className="p-2.5">Tag</th>
                <th className="p-2.5">Digest ID</th>
                <th className="p-2.5">Size</th>
                <th className="p-2.5">Created</th>
                <th className="p-2.5">Registry Target</th>
              </tr>
            </thead>
            <tbody>
              {images.map((img, i) => (
                <tr key={`${img.repository}-${img.tag}-${i}`} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                  <td className="p-2.5 font-semibold text-slate-200">{img.repository}</td>
                  <td className="p-2.5 text-sky-400">{img.tag}</td>
                  <td className="p-2.5 text-slate-500 truncate max-w-[120px]">{img.digest}</td>
                  <td className="p-2.5 text-slate-300">{img.sizeMb.toFixed(1)} MB</td>
                  <td className="p-2.5 text-slate-400">{img.created}</td>
                  <td className="p-2.5">
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                        img.isLocalRegistry
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {img.isLocalRegistry ? 'Local In-Cluster' : 'Host Docker'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
