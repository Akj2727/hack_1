import React, { useState } from 'react';
import { Transmitter } from './components/Transmitter';
import { Receiver } from './components/Receiver';
import { Waves, ArrowRightLeft, Radio, Anchor } from 'lucide-react';

const App: React.FC = () => {
  const [mode, setMode] = useState<'tx' | 'rx'>('rx');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans selection:bg-cyan-500/30 flex flex-col">
      
      {/* Technical Header */}
      <header className="bg-slate-950 border-b border-slate-800 sticky top-0 z-50">
        <div className="max-w-md mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-1.5 bg-cyan-950 border border-cyan-800 rounded">
              <Anchor className="w-5 h-5 text-cyan-400" />
            </div>
            <div className="flex flex-col">
                <h1 className="text-lg font-bold tracking-tight text-white leading-none">U-FLASH <span className="text-[10px] text-cyan-500 font-mono align-top ml-1">v2.0</span></h1>
                <span className="text-[9px] text-slate-500 font-mono tracking-widest uppercase">Optical Comm System</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></div>
             <span className="text-[9px] font-mono text-emerald-500">SYS_ONLINE</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-md mx-auto p-3 flex-1 w-full flex flex-col">
        {mode === 'tx' && <Transmitter />}
        {mode === 'rx' && <Receiver />}
      </main>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-950/95 backdrop-blur border-t border-slate-800 z-50 pb-safe">
        <div className="max-w-md mx-auto flex h-16">
          <button 
            onClick={() => setMode('tx')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden group ${mode === 'tx' ? 'text-cyan-400' : 'text-slate-600 hover:text-slate-400'}`}
          >
            {mode === 'tx' && <div className="absolute inset-0 bg-cyan-500/5" />}
            {mode === 'tx' && <div className="absolute top-0 left-0 right-0 h-[2px] bg-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]" />}
            <Radio className="w-5 h-5" />
            <span className="text-[9px] font-mono font-bold tracking-widest">TRANSMITTER</span>
          </button>
          
          <div className="w-[1px] bg-slate-800 h-full"></div>

          <button 
            onClick={() => setMode('rx')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 transition-all relative overflow-hidden group ${mode === 'rx' ? 'text-emerald-400' : 'text-slate-600 hover:text-slate-400'}`}
          >
            {mode === 'rx' && <div className="absolute inset-0 bg-emerald-500/5" />}
            {mode === 'rx' && <div className="absolute top-0 left-0 right-0 h-[2px] bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />}
            <Waves className="w-5 h-5" />
            <span className="text-[9px] font-mono font-bold tracking-widest">RECEIVER</span>
          </button>
        </div>
      </nav>
      
      {/* Safe Area Spacer */}
      <div className="h-20 bg-transparent w-full" />
    </div>
  );
};

export default App;