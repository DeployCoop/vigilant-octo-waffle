'use client';

import type { WafflePageState } from '../useWafflePage';

export default function HistoryTab({ s }: { s: WafflePageState }) {
  const {
    runHistory,
    getStepStatusBadge,
  } = s;
  return (
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
  );
}
