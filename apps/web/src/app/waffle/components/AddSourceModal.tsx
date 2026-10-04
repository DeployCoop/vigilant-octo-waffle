'use client';

import {
  X,
} from 'lucide-react';

import type { WafflePageState } from '../useWafflePage';

export default function AddSourceModal({ s }: { s: WafflePageState }) {
  const {
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
    formError,
    handleAddSource,
  } = s;
  return (
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
  );
}
