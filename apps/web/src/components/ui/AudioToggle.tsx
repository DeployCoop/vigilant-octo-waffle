'use client';

import React, { useState, useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { soundFx } from '@/lib/audio';

export const AudioToggle: React.FC = () => {
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    setMuted(soundFx.muted);
  }, []);

  const handleToggle = () => {
    const isNowMuted = soundFx.toggleMute();
    setMuted(isNowMuted);
  };

  return (
    <button
      onClick={handleToggle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono transition-all border ${
        muted
          ? 'bg-slate-800/60 border-slate-700/60 text-slate-400 hover:text-slate-200'
          : 'bg-cyan-950/40 border-cyan-500/40 text-cyan-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]'
      }`}
      title={muted ? 'Unmute Cyberdeck Audio Effects' : 'Mute Audio Effects'}
    >
      {muted ? (
        <>
          <VolumeX className="w-3.5 h-3.5 text-slate-400" />
          <span>MUTED</span>
        </>
      ) : (
        <>
          <Volume2 className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
          <span className="text-cyan-400 font-semibold">SYNTH ON</span>
        </>
      )}
    </button>
  );
};
