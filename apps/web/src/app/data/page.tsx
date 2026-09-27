'use client';

import { useState, useEffect } from 'react';
import {
  Database,
  Folder,
  File,
  Play,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Table,
  Layers,
  ExternalLink,
  Shield,
  HardDrive,
} from 'lucide-react';

interface S3Bucket {
  name: string;
  creationDate?: string;
  count?: number;
}

interface S3Object {
  key: string;
  size: number;
  lastModified?: string;
  etag?: string;
}

interface QueryResult {
  success: boolean;
  columns: string[];
  rows: any[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export default function DataStudioPage() {
  const [activeTab, setActiveTab] = useState<'sql' | 's3'>('sql');

  // S3 state
  const [buckets, setBuckets] = useState<S3Bucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [s3Loading, setS3Loading] = useState(false);
  const [s3Error, setS3Error] = useState<string | null>(null);

  // SQL state
  const [sqlQuery, setSqlQuery] = useState('SELECT datname, pg_size_pretty(pg_database_size(datname)) as size FROM pg_database;');
  const [databaseName, setDatabaseName] = useState('postgres');
  const [sqlResult, setSqlResult] = useState<QueryResult | null>(null);
  const [sqlLoading, setSqlLoading] = useState(false);
  const [sqlError, setSqlError] = useState<string | null>(null);

  // Fetch S3 buckets
  const loadS3Buckets = async () => {
    setS3Loading(true);
    setS3Error(null);
    try {
      const res = await fetch('/api/data/s3');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBuckets(data.buckets || []);
      if (data.buckets?.length > 0 && !selectedBucket) {
        setSelectedBucket(data.buckets[0].name);
      }
    } catch (err: any) {
      setS3Error(err.message || 'Failed to load S3 buckets');
    } finally {
      setS3Loading(false);
    }
  };

  // Fetch S3 objects for selected bucket
  const loadS3Objects = async (bucketName: string) => {
    if (!bucketName) return;
    setS3Loading(true);
    setS3Error(null);
    try {
      const res = await fetch(`/api/data/s3?bucket=${encodeURIComponent(bucketName)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setObjects(data.objects || []);
    } catch (err: any) {
      setS3Error(err.message || 'Failed to load bucket contents');
    } finally {
      setS3Loading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 's3') {
      loadS3Buckets();
    }
  }, [activeTab]);

  useEffect(() => {
    if (selectedBucket) {
      loadS3Objects(selectedBucket);
    }
  }, [selectedBucket]);

  // Execute SQL
  const handleExecuteSql = async () => {
    if (!sqlQuery.trim()) return;
    setSqlLoading(true);
    setSqlError(null);
    setSqlResult(null);

    try {
      const res = await fetch('/api/data/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sqlQuery, database: databaseName }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || 'SQL query failed');
      }
      setSqlResult(data);
    } catch (err: any) {
      setSqlError(err.message || 'Execution error');
    } finally {
      setSqlLoading(false);
    }
  };

  const presetQueries = [
    {
      title: 'Database Sizes',
      sql: 'SELECT datname, pg_size_pretty(pg_database_size(datname)) as size FROM pg_database ORDER BY pg_database_size(datname) DESC;',
    },
    {
      title: 'Active Connections',
      sql: 'SELECT pid, usename, client_addr, state, query FROM pg_stat_activity WHERE state IS NOT NULL LIMIT 20;',
    },
    {
      title: 'User Tables',
      sql: "SELECT tablename, tableowner, hasindexes FROM pg_catalog.pg_tables WHERE schemaname = 'public';",
    },
    {
      title: 'Server Version',
      sql: 'SELECT version();',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Database className="w-6 h-6 text-sky-400" />
            <span>Storage & Database Studio</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Safe live query runner for in-cluster PostgreSQL & object browser for MinIO S3 storage.
          </p>
        </div>

        {/* Tab Controls */}
        <div className="flex bg-slate-900 border border-slate-800 rounded-lg p-1 space-x-1">
          <button
            onClick={() => setActiveTab('sql')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 'sql'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>PostgreSQL Studio</span>
          </button>
          <button
            onClick={() => setActiveTab('s3')}
            className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              activeTab === 's3'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>MinIO S3 Explorer</span>
          </button>
        </div>
      </div>

      {/* TAB 1: PostgreSQL Studio */}
      {activeTab === 'sql' && (
        <div className="space-y-6">
          {/* Query Bar & Presets */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center space-x-2">
                <span className="text-xs font-medium text-slate-400">Database:</span>
                <input
                  type="text"
                  value={databaseName}
                  onChange={(e) => setDatabaseName(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 w-32"
                />
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs text-slate-500">Quick Templates:</span>
                {presetQueries.map((p) => (
                  <button
                    key={p.title}
                    onClick={() => setSqlQuery(p.sql)}
                    className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-0.5 rounded border border-slate-700 transition"
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            </div>

            {/* SQL Editor Area */}
            <div className="relative">
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                rows={4}
                placeholder="Enter read-only SQL query (SELECT / SHOW / EXPLAIN)..."
                className="w-full bg-slate-950 font-mono text-xs text-sky-300 p-3 rounded-lg border border-slate-800 focus:outline-none focus:border-sky-500 resize-y"
              />
            </div>

            <div className="flex items-center justify-between pt-2">
              <div className="flex items-center space-x-2 text-xs text-slate-400">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                <span>Safe Execution Guard: DDL / Destructive DML (DROP/TRUNCATE) blocked</span>
              </div>

              <button
                onClick={handleExecuteSql}
                disabled={sqlLoading || !sqlQuery.trim()}
                className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 text-white px-4 py-2 rounded-lg font-medium text-xs transition shadow-sm cursor-pointer"
              >
                {sqlLoading ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                <span>{sqlLoading ? 'Executing...' : 'Run Query'}</span>
              </button>
            </div>
          </div>

          {/* Error Notice */}
          {sqlError && (
            <div className="bg-rose-950/30 border border-rose-800/40 rounded-xl p-4 flex items-start space-x-3 text-xs text-rose-300">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Query Execution Error:</span>
                <p className="mt-1 font-mono">{sqlError}</p>
              </div>
            </div>
          )}

          {/* Query Results Table */}
          {sqlResult && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-slate-200 font-semibold">{sqlResult.rowCount} rows returned</span>
                </div>
                <span className="font-mono text-slate-500">Latency: {sqlResult.executionTimeMs}ms</span>
              </div>

              <div className="overflow-x-auto max-h-96">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60 sticky top-0">
                      {sqlResult.columns.map((col) => (
                        <th key={col} className="p-2.5 font-semibold text-slate-300">
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sqlResult.rows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30">
                        {sqlResult.columns.map((col, colIdx) => {
                          const val = Array.isArray(row) ? row[colIdx] : row[col];
                          return (
                            <td key={col} className="p-2.5 text-slate-300">
                              {val === null || val === undefined ? (
                                <span className="text-slate-600 italic">null</span>
                              ) : typeof val === 'object' ? (
                                JSON.stringify(val)
                              ) : (
                                String(val)
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}

                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MinIO S3 Explorer */}
      {activeTab === 's3' && (
        <div className="space-y-6">
          {s3Error && (
            <div className="bg-amber-950/30 border border-amber-800/40 rounded-xl p-4 flex items-start space-x-3 text-xs text-amber-300">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">S3 Notice:</span>
                <p className="mt-1">{s3Error}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            {/* Buckets List */}
            <div className="md:col-span-1 bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Buckets</span>
                <button
                  onClick={loadS3Buckets}
                  className="text-slate-400 hover:text-slate-200 transition"
                  title="Refresh Buckets"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${s3Loading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {buckets.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">
                  No buckets found or MinIO is starting up.
                </div>
              ) : (
                <div className="space-y-1">
                  {buckets.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => setSelectedBucket(b.name)}
                      className={`w-full text-left flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                        selectedBucket === b.name
                          ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      <Folder className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{b.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Objects in Selected Bucket */}
            <div className="md:col-span-3 bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <HardDrive className="w-4 h-4 text-sky-400" />
                  <span className="text-sm font-semibold text-slate-200">
                    Bucket: <span className="font-mono text-sky-400">{selectedBucket || 'None'}</span>
                  </span>
                </div>
                <span className="text-xs text-slate-500">{objects.length} objects</span>
              </div>

              {s3Loading ? (
                <div className="p-12 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Loading bucket contents...</span>
                </div>
              ) : objects.length === 0 ? (
                <div className="p-12 text-center text-xs text-slate-500">
                  This bucket is empty or object listing requires configured access keys.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left font-mono text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400">
                        <th className="p-2.5">Key / Path</th>
                        <th className="p-2.5">Size</th>
                        <th className="p-2.5">Last Modified</th>
                      </tr>
                    </thead>
                    <tbody>
                      {objects.map((obj) => (
                        <tr key={obj.key} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                          <td className="p-2.5 text-slate-300 flex items-center space-x-2">
                            <File className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{obj.key}</span>
                          </td>
                          <td className="p-2.5 text-slate-400">
                            {obj.size > 1048576
                              ? `${(obj.size / 1048576).toFixed(2)} MB`
                              : `${(obj.size / 1024).toFixed(1)} KB`}
                          </td>
                          <td className="p-2.5 text-slate-500">{obj.lastModified || 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
