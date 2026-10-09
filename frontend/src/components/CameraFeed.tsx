import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FrameTelemetry, ROI, Detection, OcclusionStatus } from '../types';
import { Activity, Clock } from 'lucide-react';

interface CameraFeedProps {
  roi: ROI;
  showROIOverlay?: boolean;
  isROIEditing?: boolean;
  onTelemetryUpdate?: (telemetry: FrameTelemetry) => void;
  cameraId?: string;
  cameraName?: string;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({
  roi,
  showROIOverlay = true,
  isROIEditing = false,
  onTelemetryUpdate,
  cameraId = 'cam-01',
  cameraName = 'CAM-01: Rizal Ave Culvert #4',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'simulated'>('connecting');
  const [fps, setFps] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const [currentStatus, setCurrentStatus] = useState<OcclusionStatus>('CLEAR');
  const [occlusionRatio, setOcclusionRatio] = useState<number>(18.5);
  const [detections, setDetections] = useState<Detection[]>([]);

  const frameCountRef = useRef<number>(0);
  const lastFpsCalcRef = useRef<number>(performance.now());
  const lastFrameTimeRef = useRef<number>(performance.now());
  const wsRef = useRef<WebSocket | null>(null);
  const simAnimIdRef = useRef<number | null>(null);

  // Fallback / Simulated video renderer when backend WebSocket is offline
  const startSimulation = useCallback(() => {
    setConnectionStatus('simulated');
    let angle = 0;
    let simTrashState = [
      { x: 0.32, y: 0.52, w: 0.12, h: 0.10, label: 'Plastic Sack', conf: 0.88, vx: 0.0003, vy: 0.0002 },
      { x: 0.48, y: 0.60, w: 0.08, h: 0.07, label: 'Plastic Bottle', conf: 0.93, vx: -0.0002, vy: 0.0004 },
      { x: 0.60, y: 0.65, w: 0.15, h: 0.14, label: 'Vegetation Cluster', conf: 0.79, vx: 0.0001, vy: -0.0003 },
    ];

    const renderSimFrame = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // 1. Background: Concrete Culvert / Drainage Canal Curb
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // Concrete pavement texture
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#1e293b');
      grad.addColorStop(0.35, '#334155');
      grad.addColorStop(0.40, '#0f172a');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      // Curb edge line
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, h * 0.38);
      ctx.lineTo(w, h * 0.38);
      ctx.stroke();

      // Water channel ripples
      angle += 0.03;
      ctx.fillStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.beginPath();
      for (let x = 0; x <= w; x += 20) {
        const wave = Math.sin(x * 0.02 + angle) * 6;
        if (x === 0) ctx.moveTo(x, h * 0.42 + wave);
        else ctx.lineTo(x, h * 0.42 + wave);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      // Draw Physical Metal Grate Bars in the active ROI zone
      const [rx1, ry1, rx2, ry2] = roi;
      const grateX1 = rx1 * w;
      const grateY1 = ry1 * h;
      const grateW = (rx2 - rx1) * w;
      const grateH = (ry2 - ry1) * h;

      // Grate cavity darkness
      ctx.fillStyle = 'rgba(2, 6, 23, 0.85)';
      ctx.fillRect(grateX1, grateY1, grateW, grateH);

      // Grate metal frame
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 6;
      ctx.strokeRect(grateX1, grateY1, grateW, grateH);

      // Vertical Grate Iron Bars
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      const numBars = 12;
      for (let i = 1; i < numBars; i++) {
        const barX = grateX1 + (grateW / numBars) * i;
        ctx.beginPath();
        ctx.moveTo(barX, grateY1);
        ctx.lineTo(barX, grateY1 + grateH);
        ctx.stroke();
      }

      // Horizontal support bars
      const numHoriz = 3;
      for (let j = 1; j < numHoriz; j++) {
        const barY = grateY1 + (grateH / numHoriz) * j;
        ctx.beginPath();
        ctx.moveTo(grateX1, barY);
        ctx.lineTo(grateX1 + grateW, barY);
        ctx.stroke();
      }

      // 2. Simulated Solid Waste Objects moving slowly near grate
      const currentDetections: Detection[] = [];
      simTrashState = simTrashState.map((obj) => {
        let nx = obj.x + obj.vx;
        let ny = obj.y + obj.vy;

        // Keep inside lower bounds
        if (nx < rx1 || nx + obj.w > rx2) obj.vx *= -1;
        if (ny < ry1 || ny + obj.h > ry2) obj.vy *= -1;

        nx = Math.max(rx1, Math.min(rx2 - obj.w, nx));
        ny = Math.max(ry1, Math.min(ry2 - obj.h, ny));

        // Draw debris blob
        ctx.fillStyle = obj.label.includes('Sack')
          ? 'rgba(244, 63, 94, 0.7)'
          : obj.label.includes('Bottle')
          ? 'rgba(56, 189, 248, 0.7)'
          : 'rgba(34, 197, 94, 0.7)';
        ctx.fillRect(nx * w, ny * h, obj.w * w, obj.h * h);

        currentDetections.push({
          label: obj.label,
          confidence: obj.conf,
          box: [nx, ny, nx + obj.w, ny + obj.h],
        });

        return { ...obj, x: nx, y: ny };
      });

      // 3. Draw YOLO Detections Bounding Boxes & Labels
      if (!isROIEditing) {
        currentDetections.forEach((det) => {
          const [dx1, dy1, dx2, dy2] = det.box;
          const bx = dx1 * w;
          const by = dy1 * h;
          const bw = (dx2 - dx1) * w;
          const bh = (dy2 - dy1) * h;

          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 2]);
          ctx.strokeRect(bx, by, bw, bh);
          ctx.setLineDash([]);

          // Tag label
          ctx.fillStyle = 'rgba(239, 68, 68, 0.9)';
          const text = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
          ctx.font = 'bold 11px ui-monospace, monospace';
          const textW = ctx.measureText(text).width;
          ctx.fillRect(bx, by - 18, textW + 8, 18);

          ctx.fillStyle = '#ffffff';
          ctx.fillText(text, bx + 4, by - 4);
        });
      }

      // 4. Draw Grate ROI Overlay if enabled
      if (showROIOverlay && !isROIEditing) {
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 3]);
        ctx.strokeRect(grateX1, grateY1, grateW, grateH);
        ctx.setLineDash([]);

        // Label for ROI
        ctx.fillStyle = 'rgba(6, 182, 212, 0.9)';
        const roiText = `GRATE ROI CALIBRATED (${((rx2 - rx1) * 100).toFixed(0)}% x ${((ry2 - ry1) * 100).toFixed(0)}%)`;
        ctx.font = 'bold 10px ui-monospace, monospace';
        const rw = ctx.measureText(roiText).width;
        ctx.fillRect(grateX1, grateY1 - 16, rw + 8, 16);
        ctx.fillStyle = '#080c14';
        ctx.fillText(roiText, grateX1 + 4, grateY1 - 4);
      }

      // 5. Compute simulated telemetry
      const totalOcclusion = 64.2 + Math.sin(angle * 0.5) * 6; // oscillates around critical ~64%
      const status: OcclusionStatus = totalOcclusion >= 60 ? 'CRITICAL BLOCKED' : totalOcclusion >= 25 ? 'WARNING' : 'CLEAR';

      setOcclusionRatio(Number(totalOcclusion.toFixed(1)));
      setCurrentStatus(status);
      setDetections(currentDetections);

      // FPS Calculation
      frameCountRef.current += 1;
      const now = performance.now();
      if (now - lastFpsCalcRef.current >= 1000) {
        setFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFpsCalcRef.current = now;
        setLatency(Math.floor(18 + Math.random() * 8));
      }

      if (onTelemetryUpdate) {
        onTelemetryUpdate({
          timestamp: Date.now(),
          fps: frameCountRef.current || 10,
          latency_ms: 22,
          occlusion_ratio: Number(totalOcclusion.toFixed(1)),
          status,
          roi,
          detections: currentDetections,
          camera_id: cameraId,
          camera_name: cameraName,
          hysteresis_ratio: '3/3 frames',
          trash_count: currentDetections.length,
          store_and_forward_queue_size: 0,
        });
      }

      simAnimIdRef.current = requestAnimationFrame(renderSimFrame);
    };

    simAnimIdRef.current = requestAnimationFrame(renderSimFrame);
  }, [roi, isROIEditing, showROIOverlay, cameraId, cameraName, onTelemetryUpdate]);

  // Connect to live WebSocket stream
  useEffect(() => {
    let active = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use 127.0.0.1 to avoid Windows IPv6 resolution latency/refusal
    const wsHost = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
    const wsUrl = `${protocol}//${wsHost}:8000/ws`;

    let reconnectTimer: number;

    const connectWS = () => {
      if (!active) return;
      try {
        setConnectionStatus('connecting');
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
          if (!active) return;
          setConnectionStatus('connected');
          // Cancel simulated loop if running
          if (simAnimIdRef.current) {
            cancelAnimationFrame(simAnimIdRef.current);
            simAnimIdRef.current = null;
          }
        };

        ws.onmessage = async (event) => {
          if (!active) return;
          const now = performance.now();
          const frameDelta = now - lastFrameTimeRef.current;
          lastFrameTimeRef.current = now;

          frameCountRef.current += 1;
          if (now - lastFpsCalcRef.current >= 1000) {
            setFps(frameCountRef.current);
            frameCountRef.current = 0;
            lastFpsCalcRef.current = now;
          }

          const canvas = canvasRef.current;
          if (!canvas) return;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          // Binary JPEG Frame
          if (event.data instanceof ArrayBuffer) {
            const blob = new Blob([event.data], { type: 'image/jpeg' });
            const imgBitmap = await createImageBitmap(blob);
            ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);
            setLatency(Math.round(frameDelta));
          } else if (typeof event.data === 'string') {
            try {
              const data = JSON.parse(event.data);
              // Typed envelopes ({type, data}) carry no flat telemetry; ignore so they cannot reset live state
              if (data.type && data.data && !data.frame) return;
              const frameSrc = data.frame || data.frame_b64 || data.image;
              if (frameSrc) {
                const img = new Image();
                img.onload = () => {
                  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = frameSrc;
              }

              const ratioVal = typeof data.occlusion_ratio === 'number'
                ? data.occlusion_ratio
                : (typeof data.detection?.occlusion_ratio === 'number' ? data.detection.occlusion_ratio : undefined);
              if (ratioVal !== undefined) {
                setOcclusionRatio(ratioVal);
              }

              // Guaranteed string status: never allow an object to enter React state
              let resolvedStatus: string = 'CLEAR';
              if (typeof data.status === 'string') {
                resolvedStatus = data.status;
              } else if (data.detection && typeof data.detection.status === 'string') {
                resolvedStatus = data.detection.status;
              } else if (data.status && typeof data.status.status === 'string') {
                resolvedStatus = data.status.status;
              }
              setCurrentStatus(resolvedStatus as OcclusionStatus);

              const detectionsList = Array.isArray(data.detections)
                ? data.detections
                : (Array.isArray(data.detection?.boxes) ? data.detection.boxes : []);
              if (Array.isArray(detectionsList)) {
                setDetections(detectionsList);
              }

              if (data.timestamp) {
                setLatency(Math.max(1, Math.round(Date.now() - Number(data.timestamp))));
              }

              if (onTelemetryUpdate) {
                onTelemetryUpdate({
                  ...data,
                  status: resolvedStatus as OcclusionStatus,
                  occlusion_ratio: ratioVal ?? 0,
                  detections: detectionsList,
                });
              }
            } catch {
              // Not JSON, ignore
            }
          }
        };

        ws.onerror = () => {
          // If WS fails, start simulated stream
          if (active && connectionStatus !== 'simulated') {
            startSimulation();
          }
        };

        ws.onclose = () => {
          if (active) {
            startSimulation();
            // Try reconnecting in 5s
            reconnectTimer = window.setTimeout(connectWS, 5000);
          }
        };
      } catch (err) {
        console.warn('[WS] WebSocket error, starting simulated video:', err);
        startSimulation();
      }
    };

    connectWS();

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (simAnimIdRef.current) {
        cancelAnimationFrame(simAnimIdRef.current);
      }
    };
  }, [startSimulation, onTelemetryUpdate]);

  return (
    <div className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl flex items-center justify-center select-none group font-sans">
      {/* Underlying HTML5 Canvas for Live CCTV Frames */}
      <canvas
        ref={canvasRef}
        width={1280}
        height={720}
        className="w-full h-full object-contain block bg-slate-950"
      />

      {/* Top Left Feed HUD */}
      <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2 pointer-events-none z-10">
        <div className="flex items-center gap-2 bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800/80 shadow-md">
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-400'
                  : connectionStatus === 'simulated'
                  ? 'bg-teal-400'
                  : 'bg-amber-400'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                connectionStatus === 'connected'
                  ? 'bg-emerald-500'
                  : connectionStatus === 'simulated'
                  ? 'bg-teal-500'
                  : 'bg-amber-500'
              }`}
            />
          </span>
          <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-200">
            {connectionStatus === 'connected'
              ? 'Live Stream'
              : connectionStatus === 'simulated'
              ? 'Demo Simulation'
              : 'Connecting...'}
          </span>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 bg-slate-950/70 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-800/80 text-slate-300 text-xs">
          <span>{cameraName}</span>
        </div>
      </div>

      {/* Top Right Live Metrics HUD (FPS & Latency) */}
      <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none z-10 text-xs">
        {/* Real-time FPS Meter */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-800/80 shadow-md">
          <Activity className="w-3.5 h-3.5 text-teal-400" />
          <span className="text-slate-400 text-[11px]">FPS:</span>
          <span
            className={`font-semibold font-mono text-xs ${
              fps >= 8 ? 'text-emerald-400' : fps >= 4 ? 'text-amber-400' : 'text-rose-400'
            }`}
          >
            {fps > 0 ? fps : 10}
          </span>
        </div>

        {/* Real-time Latency Meter */}
        <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2.5 py-1.5 rounded-xl border border-slate-800/80 shadow-md">
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-slate-400 text-[11px]">Latency:</span>
          <span
            className={`font-semibold font-mono text-xs ${
              latency < 50 ? 'text-emerald-400' : latency < 120 ? 'text-amber-400' : 'text-rose-400'
            }`}
          >
            {latency > 0 ? `${latency}ms` : '22ms'}
          </span>
        </div>
      </div>

      {/* Bottom Center Watermark / Local Edge Guarantee */}
      <div className="absolute bottom-2.5 left-3 flex items-center gap-1.5 pointer-events-none z-10 text-[11px] text-slate-400 bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800/80">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        <span>100% On-Premises Local Inference</span>
      </div>

      {/* Bottom Right Live Telemetry Pill */}
      <div className="absolute bottom-2 right-3 pointer-events-none z-10 font-mono text-xs">
        <div
          className={`px-3 py-1.5 rounded flex items-center gap-2 border shadow-lg backdrop-blur-md ${
            currentStatus === 'CRITICAL BLOCKED' || currentStatus === 'CRITICAL'
              ? 'bg-rose-950/80 border-rose-500 text-rose-200 animate-pulse'
              : currentStatus === 'WARNING'
              ? 'bg-amber-950/80 border-amber-500 text-amber-200'
              : 'bg-emerald-950/80 border-emerald-500 text-emerald-200'
          }`}
        >
          <span className="font-bold tracking-wider uppercase">{String(currentStatus || 'CLEAR')}</span>
          <span className="text-white/60">|</span>
          <span className="font-bold">{occlusionRatio}% Occlusion</span>
          <span className="text-white/60">|</span>
          <span className="text-slate-300">{detections.length} Debris Items</span>
        </div>
      </div>
    </div>
  );
};
