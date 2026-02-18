import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Zap, Monitor, StopCircle, Play, Binary, Mic, MicOff, Maximize, X, ScanBarcode, Cpu, Radio } from 'lucide-react';
import { textToBinary, PREAMBLE, manchesterEncode } from '../utils/signalProcessing';

export const Transmitter: React.FC = () => {
  const [text, setText] = useState<string>("TEST");
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [isListening, setIsListening] = useState<boolean>(false);
  const [mode, setMode] = useState<'screen' | 'torch' | 'barcode'>('screen');
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [progress, setProgress] = useState<number>(0);
  const [currentBitIndex, setCurrentBitIndex] = useState<number>(-1);
  const [rawBits, setRawBits] = useState<string>("");
  const [encodedBits, setEncodedBits] = useState<string>("");
  const [txSpeed, setTxSpeed] = useState<number>(30); // ms
  const [log, setLog] = useState<string[]>([]);
  
  const screenRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const intervalRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);

  const addLog = (msg: string) => {
    setLog(prev => [`> ${msg}`, ...prev.slice(0, 4)]);
  };

  // Initialize Torch
  useEffect(() => {
    const initTorch = async () => {
      if (mode === 'torch') {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' }
          });
          streamRef.current = stream;
          trackRef.current = stream.getVideoTracks()[0];
          
          const capabilities = trackRef.current.getCapabilities();
          if (!('torch' in capabilities)) {
            addLog("WARN: TORCH_API_UNAVAILABLE");
          } else {
             addLog("HARDWARE: TORCH_INIT_OK");
          }
        } catch (err) {
          addLog("ERR: HARDWARE_ACCESS_DENIED");
        }
      } else {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
          trackRef.current = null;
        }
      }
    };
    initTorch();
    return () => {
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, [mode]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFullScreen = !!document.fullscreenElement || !!(document as any).webkitFullscreenElement;
      if (!isNativeFullScreen && isFullScreen) setIsFullScreen(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isFullScreen]);

  // Update packet bits logic
  useEffect(() => {
    if (!text) {
      setRawBits("");
      setEncodedBits("");
      return;
    }
    const binary = textToBinary(text);
    setRawBits(binary);
    
    // Technical upgrade: Actually show Manchester encoding if we were using it fully, 
    // but for the basic rolling shutter demo we often stick to NRZ (Non-Return-to-Zero) + Preamble.
    // However, let's display the full Preamble + Data packet structure.
    setEncodedBits(PREAMBLE + binary); 
  }, [text]);

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addLog("ERR: SPEECH_API_MISSING");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onstart = () => { setIsListening(true); addLog("AUDIO_INPUT: LISTENING"); };
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setText(transcript.toUpperCase().substring(0, 20));
      addLog(`AUDIO_PARSE: "${transcript}"`);
    };
    recognition.onerror = (event: any) => { setIsListening(false); addLog(`ERR: ${event.error}`); };
    recognition.onend = () => { setIsListening(false); };
    recognitionRef.current = recognition;
    recognition.start();
  };

  const setTorchState = async (on: boolean) => {
    if (trackRef.current) {
      try {
        // @ts-ignore
        await trackRef.current.applyConstraints({ advanced: [{ torch: on }] });
      } catch (e) { /* Ignore */ }
    }
  };

  const setScreenState = (on: boolean) => {
    if (screenRef.current) {
      screenRef.current.style.backgroundColor = on ? 'white' : 'black';
    }
  };

  const transmit = useCallback(async () => {
    if (!text) return;
    setIsTransmitting(true);
    addLog(`SEQ_START: ${encodedBits.length} BITS @ ${Math.round(1000/txSpeed)}HZ`);

    const packet = encodedBits; 
    let index = 0;
    
    intervalRef.current = setInterval(async () => {
      if (index >= packet.length) {
        clearInterval(intervalRef.current);
        setIsTransmitting(false);
        setScreenState(false);
        setTorchState(false);
        addLog("SEQ_COMPLETE");
        setProgress(0);
        setCurrentBitIndex(-1);
        return;
      }

      const bit = packet[index];
      const isOn = bit === '1';
      setCurrentBitIndex(index);

      if (mode === 'screen') setScreenState(isOn);
      else await setTorchState(isOn);

      setProgress(Math.round(((index + 1) / packet.length) * 100));
      index++;
    }, txSpeed);

  }, [encodedBits, mode, txSpeed]);

  const stopTransmission = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setIsTransmitting(false);
    setScreenState(false);
    setTorchState(false);
    setProgress(0);
    setCurrentBitIndex(-1);
    addLog("SEQ_ABORT");
  };

  const toggleFullScreen = async () => {
    const nextState = !isFullScreen;
    if (nextState && screenRef.current) {
        try {
            if (screenRef.current.requestFullscreen) await screenRef.current.requestFullscreen();
            else if ((screenRef.current as any).webkitRequestFullscreen) (screenRef.current as any).webkitRequestFullscreen();
        } catch (e) { console.warn("Fullscreen failed"); }
    } else {
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
        } catch (e) {}
    }
    setIsFullScreen(nextState);
  };

  return (
    <div className="flex flex-col h-full space-y-4 font-mono">
      {/* Screen Modulator Area */}
      <div 
        ref={screenRef}
        className={`
          transition-all duration-100 ease-linear relative overflow-hidden group
          ${isFullScreen 
            ? 'fixed inset-0 z-[100] w-screen h-screen flex flex-col items-center justify-center' 
            : 'w-full h-40 rounded-lg border border-slate-700 flex items-center justify-center shadow-lg'}
          ${mode === 'torch' ? 'bg-slate-900' : 'bg-black'}
          ${mode === 'barcode' ? 'bg-black p-4' : ''}
        `}
        onClick={() => {
          if (isFullScreen && (isTransmitting || mode === 'barcode')) {
             if (mode !== 'barcode') stopTransmission();
             else toggleFullScreen();
          }
        }}
      >
        {/* Technical Grid Background */}
        {!isTransmitting && !isFullScreen && (
            <div className="absolute inset-0 bg-[linear-gradient(rgba(30,41,59,0.5)_1px,transparent_1px),linear-gradient(90deg,rgba(30,41,59,0.5)_1px,transparent_1px)] bg-[size:20px_20px] opacity-20 pointer-events-none" />
        )}

        {/* Normal Mode Content */}
        {!isFullScreen && mode === 'screen' && (
          <div className="flex flex-col items-center gap-2 z-10">
             <span className={`text-xl font-bold tracking-widest ${isTransmitting ? 'text-slate-900 invert mix-blend-difference' : 'text-slate-600'}`}>
                {isTransmitting ? 'TX_ACTIVE' : 'MODULATOR_STANDBY'}
             </span>
             {isTransmitting && (
                <span className="text-sm font-bold text-slate-900 invert mix-blend-difference">
                   IDX: {currentBitIndex}/{encodedBits.length}
                </span>
             )}
          </div>
        )}
        
        {!isFullScreen && mode === 'torch' && (
          <span className="text-slate-500 flex flex-col items-center gap-2 z-10">
            <Zap className={`w-8 h-8 ${isTransmitting ? 'text-white animate-pulse' : 'text-amber-600'}`} />
            <span className="text-xs tracking-wider">{isTransmitting ? `FLASHLIGHT_MODULATING` : 'PH_INTERFACE_READY'}</span>
          </span>
        )}

        {/* Barcode Mode */}
        {mode === 'barcode' && (
          <div className="w-full h-full flex flex-col justify-center items-center gap-2">
             <div className="flex-1 w-full flex flex-col items-stretch justify-center gap-0 bg-black max-w-[80%] mx-auto border-x border-slate-800">
                {encodedBits.split('').map((bit, i) => (
                  <div key={i} className={`w-full flex-1 ${bit === '1' ? 'bg-white' : 'bg-black'}`} style={{ minHeight: isFullScreen ? '2%' : '4px' }} />
                ))}
             </div>
             {!isFullScreen && <span className="text-slate-600 text-[10px] uppercase">STATIC_PATTERN_GENERATOR</span>}
          </div>
        )}

        {/* Expand Button */}
        {!isFullScreen && (mode === 'screen' || mode === 'barcode') && (
          <button 
            onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }}
            className="absolute bottom-2 right-2 p-1.5 bg-slate-800 border border-slate-600 rounded text-slate-400 hover:text-white z-10"
          >
            <Maximize className="w-4 h-4" />
          </button>
        )}

        {/* Fullscreen Overlay */}
        {isFullScreen && mode !== 'barcode' && (
          <div className={`flex flex-col items-center gap-8 ${isTransmitting ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <button onClick={(e) => { e.stopPropagation(); toggleFullScreen(); }} className="absolute top-8 right-8 p-4 bg-black/50 backdrop-blur rounded-full text-white border border-slate-500">
              <X className="w-8 h-8" />
            </button>
            <div className="text-center space-y-2 pointer-events-none select-none">
              <h2 className="text-4xl font-bold text-white tracking-widest">FULLSCREEN_MODULATOR</h2>
              <p className="text-slate-500 font-mono">INITIATE SEQUENCE WHEN READY</p>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); transmit(); }}
              className="bg-emerald-600/90 hover:bg-emerald-500 text-white text-xl font-bold py-6 px-12 rounded border border-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.3)] flex items-center gap-3 backdrop-blur"
            >
              <Play className="w-8 h-8" /> EXECUTE
            </button>
          </div>
        )}
        
        {/* Fullscreen TX Visualization */}
        {isFullScreen && isTransmitting && (
           <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mix-blend-difference text-white">
              <span className="text-9xl font-black font-mono">{encodedBits[currentBitIndex] || '0'}</span>
              <div className="w-1/2 h-1 bg-gray-800 mt-8"><div className="h-full bg-white" style={{ width: `${progress}%` }}></div></div>
           </div>
        )}
      </div>

      {/* Main Control Panel */}
      <div className="flex flex-col gap-3 bg-slate-900 p-3 rounded-lg border border-slate-800 shadow-xl">
        
        {/* Configuration Row */}
        <div className="flex gap-2 items-center justify-between border-b border-slate-800 pb-3">
           <div className="flex flex-col gap-1">
              <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Clock Frequency</label>
              <div className="flex gap-1">
                 {[60, 30, 15].map(speed => (
                    <button 
                      key={speed}
                      onClick={() => setTxSpeed(speed)}
                      className={`px-2 py-1 text-[10px] rounded border ${txSpeed === speed ? 'bg-cyan-900/30 border-cyan-500 text-cyan-400' : 'bg-slate-950 border-slate-700 text-slate-500'}`}
                    >
                      {Math.round(1000/speed)}Hz
                    </button>
                 ))}
              </div>
           </div>
           <div className="flex flex-col gap-1 text-right">
              <label className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Protocol</label>
              <span className="text-[10px] text-cyan-600 font-bold">OOK-RZ / MANCHESTER</span>
           </div>
        </div>

        {/* Input Area */}
        <div>
          <label className="text-[9px] text-slate-500 uppercase font-bold tracking-widest flex items-center gap-1 mb-1">
             <Cpu className="w-3 h-3" /> Payload Buffer
          </label>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={text} 
              onChange={(e) => setText(e.target.value.toUpperCase())}
              className="flex-1 bg-slate-950 border border-slate-700 rounded p-2 text-sm text-white focus:border-cyan-500 outline-none font-mono"
              placeholder="DATA..."
              maxLength={20}
            />
            <button 
              onClick={toggleListening}
              className={`px-3 rounded border transition-all ${isListening ? 'bg-red-900/20 border-red-500 text-red-500 animate-pulse' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-white'}`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mode Selectors */}
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setMode('screen')} className={`p-2 rounded border flex flex-col items-center gap-1 transition-all ${mode === 'screen' ? 'bg-cyan-900/20 border-cyan-500 text-cyan-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <Monitor className="w-4 h-4" /> <span className="text-[9px] font-bold">SCREEN_MOD</span>
          </button>
          <button onClick={() => setMode('torch')} className={`p-2 rounded border flex flex-col items-center gap-1 transition-all ${mode === 'torch' ? 'bg-amber-900/20 border-amber-500 text-amber-500' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <Zap className="w-4 h-4" /> <span className="text-[9px] font-bold">TORCH_MOD</span>
          </button>
          <button onClick={() => setMode('barcode')} className={`p-2 rounded border flex flex-col items-center gap-1 transition-all ${mode === 'barcode' ? 'bg-purple-900/20 border-purple-500 text-purple-400' : 'bg-slate-950 border-slate-800 text-slate-500'}`}>
            <ScanBarcode className="w-4 h-4" /> <span className="text-[9px] font-bold">PATTERN_GEN</span>
          </button>
        </div>

        {/* Action Button */}
        {isTransmitting && mode !== 'barcode' ? (
          <button onClick={stopTransmission} className="w-full bg-red-900/80 hover:bg-red-800 text-white font-bold py-3 rounded border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)] flex items-center justify-center gap-2">
            <StopCircle className="w-5 h-5" /> ABORT_SEQUENCE
          </button>
        ) : (
          <button onClick={mode === 'barcode' ? toggleFullScreen : transmit} className={`w-full font-bold py-3 rounded border flex items-center justify-center gap-2 ${mode === 'barcode' ? 'bg-purple-900/50 border-purple-500 text-purple-100' : 'bg-emerald-900/50 border-emerald-500 text-emerald-100 hover:bg-emerald-800/50'} shadow-lg`}>
            {mode === 'barcode' ? <Maximize className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            {mode === 'barcode' ? 'ENGAGE_FULLSCREEN' : 'INITIATE_TX'}
          </button>
        )}
      </div>

      {/* Bit Visualizer */}
      <div className="bg-slate-950 p-2 rounded border border-slate-800 overflow-hidden flex flex-col gap-1 h-24">
        <div className="flex justify-between items-center text-[9px] text-slate-500 font-bold uppercase tracking-wider border-b border-slate-800 pb-1">
          <div className="flex items-center gap-1"><Binary className="w-3 h-3" /> TX_BUFFER</div>
          <div className="flex items-center gap-1"><Radio className="w-3 h-3" /> {progress}%</div>
        </div>
        
        {/* Scrolling Bit View */}
        <div className="flex-1 overflow-x-auto custom-scrollbar flex items-center">
            <div className="flex gap-[1px]">
            {encodedBits.split('').map((bit, i) => (
                <div key={i} className={`w-2 h-8 flex items-end justify-center pb-[2px] text-[6px] transition-all
                    ${i === currentBitIndex ? 'bg-cyan-500 text-black h-10' : 
                    i < PREAMBLE.length ? 'bg-slate-800 text-slate-500' : 'bg-slate-900 text-slate-600'}`}>
                {bit}
                </div>
            ))}
            </div>
        </div>
      </div>

      {/* Logs */}
      <div className="flex-1 bg-black p-2 rounded border border-slate-800 overflow-y-auto text-[9px] font-mono text-slate-400">
         {log.map((entry, i) => <div key={i} className="mb-0.5">{entry}</div>)}
      </div>
    </div>
  );
};