import React, { useRef, useEffect, useState } from 'react';
import { Camera, RefreshCw, Crosshair, Signal, Volume2, Sparkles, CheckCircle2, ScanLine, Binary, Activity, TerminalSquare, Settings2 } from 'lucide-react';
import { detectROI, extractVerticalScanline, binarizeSignal, decodeScanline } from '../utils/signalProcessing';

export const Receiver: React.FC = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scopeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [roiData, setRoiData] = useState<{x: number, y: number, r: number, brightness: number} | null>(null);
  const [decodedText, setDecodedText] = useState<string>("WAITING_FOR_SIGNAL");
  const [detectedBits, setDetectedBits] = useState<string>("");
  const [fps, setFps] = useState(0);
  const [snr, setSnr] = useState(0);
  const [lastDecodedChar, setLastDecodedChar] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);
  const [sysLog, setSysLog] = useState<string[]>(["SYSTEM_INIT: READY"]);

  const addLog = (msg: string) => {
    setSysLog(prev => [`[${new Date().toLocaleTimeString().split(' ')[0]}] ${msg}`, ...prev.slice(0, 5)]);
  };

  // Start Camera with better error handling
  const startCamera = async () => {
    try {
      if (!window.isSecureContext) throw new Error("INSECURE_CONTEXT");
      
      addLog("INIT_CAMERA_SENSOR...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 60 } 
        } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setIsActive(true);
        setDecodedText("SCANNING...");
        addLog("SENSOR_ACTIVE: 60FPS_TARGET");
      }
    } catch (err: any) {
      console.error(err);
      setDecodedText("SENSOR_ERROR");
      addLog(`ERR: ${err.name}`);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
      setIsActive(false);
      addLog("SENSOR_HALTED");
    }
  };

  const speakText = () => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(decodedText);
      window.speechSynthesis.speak(utterance);
    }
  };

  // Processing Loop
  useEffect(() => {
    let animationId: number;
    let lastTime = performance.now();
    let frameCount = 0;
    let lastCharTime = 0;

    const processFrame = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const scopeCanvas = scopeCanvasRef.current;

      if (video && canvas && scopeCanvas && isActive && video.readyState === 4) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const scopeCtx = scopeCanvas.getContext('2d');

        if (ctx && scopeCtx) {
          // 1. Draw video frame to canvas
          canvas.width = video.videoWidth / 2; 
          canvas.height = video.videoHeight / 2;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // 2. Get image data
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;

          // 3. Detect Region of Interest (ROI)
          let roi = detectROI(data, canvas.width, canvas.height);

          // Fallback logic
          if (!roi) {
             const centerX = canvas.width / 2;
             const centerY = canvas.height / 2;
             const i = (Math.floor(centerY) * canvas.width + Math.floor(centerX)) * 4;
             const brightness = (data[i] + data[i+1] + data[i+2]) / 3;
             
             if (brightness > 50) { 
                 roi = { x: centerX, y: centerY, radius: 50, brightness: brightness };
             }
          }

          if (roi) {
            setRoiData({ x: roi.x, y: roi.y, r: roi.radius, brightness: roi.brightness });

            // Draw technical overlays
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.8)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(roi.x, roi.y, roi.radius + 10, 0, 2 * Math.PI);
            ctx.stroke();

            // Crosshair
            ctx.beginPath();
            ctx.moveTo(roi.x - 20, roi.y);
            ctx.lineTo(roi.x + 20, roi.y);
            ctx.moveTo(roi.x, roi.y - 20);
            ctx.lineTo(roi.x, roi.y + 20);
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
            ctx.stroke();

            // 4. Extract Scanline
            const scanline = extractVerticalScanline(data, canvas.width, canvas.height, roi.x);
            
            // Calculate SNR (Contrast ratio approx)
            const min = Math.min(...scanline);
            const max = Math.max(...scanline);
            const avg = scanline.reduce((a,b)=>a+b,0) / scanline.length;
            const currentSnr = avg > 0 ? ((max - min) / avg) * 10 : 0;
            setSnr(currentSnr);

            // 5. Binarize
            const binaryScan = binarizeSignal(scanline);

            // --- OSCILLOSCOPE VISUALIZATION ---
            scopeCanvas.width = 120;
            scopeCanvas.height = scanline.length; // Match height to video
            scopeCtx.clearRect(0, 0, 120, scanline.length);
            
            // Draw Grid
            scopeCtx.strokeStyle = '#1e293b';
            scopeCtx.lineWidth = 1;
            scopeCtx.beginPath();
            for(let i=0; i<120; i+=20) { scopeCtx.moveTo(i,0); scopeCtx.lineTo(i, scopeCanvas.height); }
            scopeCtx.stroke();

            // Draw Signal (Luminance)
            scopeCtx.strokeStyle = '#10b981'; // Emerald
            scopeCtx.lineWidth = 2;
            scopeCtx.beginPath();
            for (let y = 0; y < scanline.length; y++) {
               // Map 0-255 brightness to 0-120 width
               const x = (scanline[y] / 255) * 120;
               if (y===0) scopeCtx.moveTo(x, y);
               else scopeCtx.lineTo(x, y);
            }
            scopeCtx.stroke();

            // Draw Threshold (Visual approximation)
            scopeCtx.strokeStyle = 'rgba(239, 68, 68, 0.5)'; // Red
            scopeCtx.beginPath();
            // Just drawing a simple center line for concept, though algo is adaptive
            scopeCtx.moveTo(60, 0); 
            scopeCtx.lineTo(60, scopeCanvas.height);
            scopeCtx.stroke();
            // ----------------------------------

            // 6. DECODE
            const { char, bits } = decodeScanline(binaryScan);
            
            if (bits.length > 0) {
               setDetectedBits(bits.substring(0, 48)); 
            }

            if (char) {
               const now = Date.now();
               if (now - lastCharTime > 800) { // Debounce
                 setLastDecodedChar(char);
                 setDecodedText(prev => (prev.includes("WAITING") || prev.includes("SCANNING") || prev.includes("ERROR")) ? char : prev + char);
                 setSuccessFlash(true);
                 addLog(`RX_PACKET_ACK: '${char}'`);
                 setTimeout(() => setSuccessFlash(false), 200);
                 lastCharTime = now;
               }
            }

          } else {
            setRoiData(null);
            setDetectedBits("NO_CARRIER");
            setSnr(0);
            scopeCtx.fillStyle = '#0f172a';
            scopeCtx.fillRect(0,0, scopeCanvas.width, scopeCanvas.height);
          }
        }
      }

      // FPS Counter
      frameCount++;
      const now = performance.now();
      if (now - lastTime >= 1000) {
        setFps(frameCount);
        frameCount = 0;
        lastTime = now;
      }

      animationId = requestAnimationFrame(processFrame);
    };

    if (isActive) {
      animationId = requestAnimationFrame(processFrame);
    }

    return () => cancelAnimationFrame(animationId);
  }, [isActive]);

  const isStatusMessage = decodedText.includes("_");

  return (
    <div className={`flex flex-col h-full space-y-4 font-mono transition-colors duration-100 ${successFlash ? 'bg-emerald-900/30' : ''}`}>
      
      {/* Sensor Viewport with HUD Overlay */}
      <div className={`relative w-full h-64 bg-slate-950 rounded-lg overflow-hidden border border-slate-700 shrink-0 group`}>
        {!isActive && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-600 flex-col gap-2">
            <Camera className="w-12 h-12 opacity-50" />
            <span className="text-xs tracking-widest">SENSOR_OFFLINE</span>
          </div>
        )}
        
        <video ref={videoRef} className="absolute opacity-0 pointer-events-none" playsInline muted />
        <canvas ref={canvasRef} className="w-full h-full object-cover opacity-80" />

        {/* HUD Elements */}
        <div className="absolute inset-0 pointer-events-none p-2 flex flex-col justify-between">
            <div className="flex justify-between items-start">
                <div className="bg-slate-900/80 backdrop-blur border border-slate-700 px-2 py-1 rounded text-[10px] text-cyan-400">
                    <div>FPS: {fps}</div>
                    <div>RES: 1280x720</div>
                </div>
                {roiData && (
                    <div className="bg-slate-900/80 backdrop-blur border border-emerald-900 px-2 py-1 rounded text-[10px] text-emerald-400 animate-pulse">
                        <div>ROI_LOCKED</div>
                        <div>LUM: {Math.round(roiData.brightness)}</div>
                    </div>
                )}
            </div>
            
            {/* Crosshair Overlay */}
            {isActive && (
               <div className="absolute inset-0 flex items-center justify-center opacity-20">
                  <div className="w-[1px] h-full bg-cyan-500"></div>
                  <div className="h-[1px] w-full bg-cyan-500 absolute"></div>
                  <div className="w-32 h-32 border border-cyan-500/50 rounded-full absolute"></div>
               </div>
            )}
        </div>

        {successFlash && (
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10">
             <div className="border-2 border-emerald-400 p-2 rounded animate-ping text-emerald-400 font-bold text-xs">
               PACKET_RECEIVED
             </div>
          </div>
        )}
      </div>

      {/* Technical Control Panel */}
      <div className="flex gap-2 flex-1 min-h-[16rem]">
        
        {/* Channel 1: Oscilloscope */}
        <div className="w-24 bg-slate-950 rounded border border-slate-800 flex flex-col overflow-hidden relative">
          <div className="bg-slate-900 px-1 py-1 text-[8px] text-slate-400 border-b border-slate-800 flex justify-between">
            <span>SCOPE_Y</span>
            <span>CH1</span>
          </div>
          <div className="relative flex-1">
             <canvas ref={scopeCanvasRef} className="w-full h-full bg-slate-950" />
             {/* Labels on top of canvas */}
             <div className="absolute bottom-0 left-0 text-[8px] text-emerald-600 px-1">LOW</div>
             <div className="absolute bottom-0 right-0 text-[8px] text-emerald-600 px-1">HIGH</div>
          </div>
        </div>

        {/* Data Panel */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          
          <div className="flex gap-2 h-12">
             <button 
               onClick={isActive ? stopCamera : startCamera}
               className={`flex-1 rounded font-bold text-xs tracking-wider flex items-center justify-center gap-2 border transition-all ${isActive ? 'bg-slate-900 border-red-900 text-red-500 hover:bg-red-900/20' : 'bg-cyan-900/20 border-cyan-800 text-cyan-400 hover:bg-cyan-900/40'}`}
             >
               {isActive ? 'HALT_SENSOR' : 'INIT_SENSOR'}
             </button>
             
             {/* Signal Metrics */}
             <div className="w-24 bg-slate-900 border border-slate-800 rounded flex flex-col items-center justify-center px-2">
                 <div className="text-[8px] text-slate-500 uppercase">Signal SNR</div>
                 <div className={`text-xs font-bold ${snr > 2 ? 'text-emerald-400' : 'text-amber-500'}`}>
                    {snr.toFixed(1)} dB
                 </div>
                 <div className="w-full h-1 bg-slate-800 mt-1 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${Math.min(snr * 10, 100)}%` }} />
                 </div>
             </div>
          </div>

          {/* Decoding Terminal */}
          <div className="flex-1 bg-slate-950 rounded border border-slate-800 p-3 flex flex-col shadow-inner relative overflow-hidden">
            <div className="flex items-center justify-between mb-2 border-b border-slate-800 pb-2">
              <div className="flex items-center gap-2 text-cyan-500">
                <TerminalSquare className="w-4 h-4" />
                <span className="text-[10px] font-bold tracking-widest">DECODED_PAYLOAD</span>
              </div>
              <div className="flex gap-2">
                 {!isStatusMessage && (
                    <button onClick={() => setDecodedText("WAITING...")} className="text-[9px] text-slate-500 hover:text-cyan-400 uppercase">
                    CLR_BUFF
                    </button>
                 )}
                 <button onClick={speakText} className="text-slate-500 hover:text-cyan-400">
                   <Volume2 className="w-3 h-3" />
                 </button>
              </div>
            </div>
            
            <div className={`flex-1 font-mono overflow-y-auto custom-scrollbar ${isStatusMessage ? 'flex items-center justify-center' : ''}`}>
               {isStatusMessage ? (
                 <span className="text-slate-700 text-xs animate-pulse">_CURSOR_WAITING</span>
               ) : (
                 <span className="text-lg text-emerald-400 leading-tight break-all drop-shadow-[0_0_5px_rgba(16,185,129,0.5)]">{decodedText}</span>
               )}
            </div>
          </div>
          
          {/* System Log / Bit Stream */}
          <div className="h-20 bg-slate-900 border border-slate-800 rounded p-2 flex flex-col gap-1 overflow-hidden">
             <div className="flex items-center gap-2 text-[9px] text-slate-500 font-bold uppercase tracking-wider border-b border-slate-800 pb-1">
                <Activity className="w-3 h-3" /> 
                <span>RAW_BITSTREAM_MONITOR</span>
             </div>
             <div className="font-mono text-[9px] text-cyan-700 break-all leading-none opacity-80">
                {detectedBits || "0000000000000000..."}
             </div>
             <div className="flex flex-col mt-auto pt-1">
                {sysLog.slice(0,1).map((log, i) => (
                    <span key={i} className="text-[8px] text-slate-500 truncate">{log}</span>
                ))}
             </div>
          </div>

        </div>
      </div>
    </div>
  );
};