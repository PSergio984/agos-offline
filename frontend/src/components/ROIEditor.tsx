import React, { useState, useRef, useEffect, useCallback } from 'react';
import { ROI } from '../types';
import { saveROI } from '../services/api';
import { Check, RotateCcw, Save, Move, Sliders, AlertCircle } from 'lucide-react';

interface ROIEditorProps {
  initialROI: ROI;
  cameraId: string;
  onSave?: (newROI: ROI) => void;
  onClose?: () => void;
  isActive: boolean;
}

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'w' | 'e' | null;

const DEFAULT_ROI: ROI = [0, 0, 1, 1];

export const ROIEditor: React.FC<ROIEditorProps> = ({
  initialROI,
  cameraId,
  onSave,
  onClose,
  isActive,
}) => {
  const [roi, setRoi] = useState<ROI>(initialROI);
  const [dragMode, setDragMode] = useState<DragMode>(null);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; initialRoi: ROI }>({
    mouseX: 0,
    mouseY: 0,
    initialRoi: initialROI,
  });

  useEffect(() => {
    setRoi(initialROI);
  }, [initialROI]);

  const [xMin, yMin, xMax, yMax] = roi;

  // Convert normalized ROI to percentages
  const leftPct = xMin * 100;
  const topPct = yMin * 100;
  const widthPct = (xMax - xMin) * 100;
  const heightPct = (yMax - yMin) * 100;

  const startDrag = (e: React.MouseEvent, mode: DragMode) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current) return;

    setDragMode(mode);
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      initialRoi: [...roi] as ROI,
    };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragMode || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const deltaX = (e.clientX - dragStartRef.current.mouseX) / rect.width;
    const deltaY = (e.clientY - dragStartRef.current.mouseY) / rect.height;

    const [initXMin, initYMin, initXMax, initYMax] = dragStartRef.current.initialRoi;
    const minSize = 0.05; // 5% minimum box size

    let nxMin = initXMin;
    let nyMin = initYMin;
    let nxMax = initXMax;
    let nyMax = initYMax;

    if (dragMode === 'move') {
      const boxW = initXMax - initXMin;
      const boxH = initYMax - initYMin;

      nxMin = Math.max(0, Math.min(1 - boxW, initXMin + deltaX));
      nyMin = Math.max(0, Math.min(1 - boxH, initYMin + deltaY));
      nxMax = nxMin + boxW;
      nyMax = nyMin + boxH;
    } else {
      if (dragMode.includes('w')) {
        nxMin = Math.max(0, Math.min(initXMax - minSize, initXMin + deltaX));
      }
      if (dragMode.includes('e')) {
        nxMax = Math.min(1, Math.max(initXMin + minSize, initXMax + deltaX));
      }
      if (dragMode.includes('n')) {
        nyMin = Math.max(0, Math.min(initYMax - minSize, initYMin + deltaY));
      }
      if (dragMode.includes('s')) {
        nyMax = Math.min(1, Math.max(initYMin + minSize, initYMax + deltaY));
      }
    }

    // Round to 3 decimal places
    setRoi([
      Math.round(nxMin * 1000) / 1000,
      Math.round(nyMin * 1000) / 1000,
      Math.round(nxMax * 1000) / 1000,
      Math.round(nyMax * 1000) / 1000,
    ]);
  }, [dragMode]);

  const handleMouseUp = useCallback(() => {
    setDragMode(null);
  }, []);

  useEffect(() => {
    if (dragMode) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, handleMouseMove, handleMouseUp]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await saveROI(cameraId, roi);
      if (res.success) {
        setSaveSuccess(true);
        if (onSave) onSave(roi);
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        setSaveError('Failed to persist ROI to backend.');
      }
    } catch {
      setSaveError('Error connecting to backend service.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setRoi(DEFAULT_ROI);
  };

  if (!isActive) return null;

  return (
    <div className="absolute inset-0 z-20 select-none overflow-hidden" ref={containerRef}>
      {/* Dark semi-transparent mask outside ROI */}
      <div
        className="absolute inset-0 bg-slate-950/60 pointer-events-none"
        style={{
          clipPath: `polygon(
            0% 0%, 0% 100%, 100% 100%, 100% 0%, 0% 0%,
            ${leftPct}% ${topPct}%,
            ${leftPct + widthPct}% ${topPct}%,
            ${leftPct + widthPct}% ${topPct + heightPct}%,
            ${leftPct}% ${topPct + heightPct}%,
            ${leftPct}% ${topPct}%
          )`,
        }}
      />

      {/* Interactive Grate ROI Box */}
      <div
        className="absolute border-2 border-cyan-400 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.4)] cursor-move"
        style={{
          left: `${leftPct}%`,
          top: `${topPct}%`,
          width: `${widthPct}%`,
          height: `${heightPct}%`,
        }}
        onMouseDown={(e) => startDrag(e, 'move')}
      >
        {/* Grate Bar Simulation Grid Lines */}
        <div className="absolute inset-0 pointer-events-none opacity-25 grid grid-cols-6 grid-rows-3 border border-cyan-400/40">
          {Array.from({ length: 18 }).map((_, idx) => (
            <div key={idx} className="border border-cyan-300/30" />
          ))}
        </div>

        {/* Center Move Anchor */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-slate-900/90 text-cyan-300 text-xs px-2.5 py-1 rounded-full border border-cyan-500/40 flex items-center gap-1.5 shadow-lg backdrop-blur-sm">
            <Move className="w-3.5 h-3.5" />
            <span className="font-mono font-bold">DRAG GRATE ROI</span>
          </div>
        </div>

        {/* Corner Handles */}
        <div
          className="absolute -top-2 -left-2 w-4 h-4 bg-cyan-400 border-2 border-slate-950 rounded-sm cursor-nwse-resize shadow-md hover:scale-125 transition-transform"
          onMouseDown={(e) => startDrag(e, 'nw')}
        />
        <div
          className="absolute -top-2 -right-2 w-4 h-4 bg-cyan-400 border-2 border-slate-950 rounded-sm cursor-nesw-resize shadow-md hover:scale-125 transition-transform"
          onMouseDown={(e) => startDrag(e, 'ne')}
        />
        <div
          className="absolute -bottom-2 -left-2 w-4 h-4 bg-cyan-400 border-2 border-slate-950 rounded-sm cursor-nesw-resize shadow-md hover:scale-125 transition-transform"
          onMouseDown={(e) => startDrag(e, 'sw')}
        />
        <div
          className="absolute -bottom-2 -right-2 w-4 h-4 bg-cyan-400 border-2 border-slate-950 rounded-sm cursor-nwse-resize shadow-md hover:scale-125 transition-transform"
          onMouseDown={(e) => startDrag(e, 'se')}
        />

        {/* Edge Middle Handles */}
        <div
          className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1.5 w-6 h-3 bg-cyan-300 border border-slate-950 rounded-sm cursor-ns-resize shadow"
          onMouseDown={(e) => startDrag(e, 'n')}
        />
        <div
          className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1.5 w-6 h-3 bg-cyan-300 border border-slate-950 rounded-sm cursor-ns-resize shadow"
          onMouseDown={(e) => startDrag(e, 's')}
        />
        <div
          className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1.5 w-3 h-6 bg-cyan-300 border border-slate-950 rounded-sm cursor-ew-resize shadow"
          onMouseDown={(e) => startDrag(e, 'w')}
        />
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1.5 w-3 h-6 bg-cyan-300 border border-slate-950 rounded-sm cursor-ew-resize shadow"
          onMouseDown={(e) => startDrag(e, 'e')}
        />

        {/* Dimension Callout Tag */}
        <div className="absolute -bottom-7 left-0 bg-slate-900/90 text-cyan-300 text-[10px] font-mono px-2 py-0.5 rounded border border-cyan-500/50 pointer-events-none whitespace-nowrap shadow-md">
          [{Math.round(xMin * 1280)}, {Math.round(yMin * 720)}] → [{Math.round(xMax * 1280)}, {Math.round(yMax * 720)}] ({widthPct.toFixed(0)}% × {heightPct.toFixed(0)}%)
        </div>
      </div>

      {/* Floating Toolbar Controls */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 bg-[#0B1526]/95 border border-slate-700/60 backdrop-blur-md rounded-2xl p-2.5 sm:p-3 shadow-2xl flex items-center gap-3 font-sans">
        <div className="flex items-center gap-2 pr-3 border-r border-slate-700/80 text-xs text-slate-300">
          <Sliders className="w-4 h-4 text-teal-400" />
          <span className="font-semibold text-white">ROI Calibrator</span>
        </div>

        <button
          type="button"
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border border-slate-800 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>

        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-all shadow-md cursor-pointer ${
            saveSuccess
              ? 'bg-emerald-600 text-white'
              : 'bg-primary hover:bg-primary/90 text-white'
          }`}
        >
          {saveSuccess ? (
            <>
              <Check className="w-3.5 h-3.5" />
              <span>Saved!</span>
            </>
          ) : (
            <>
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Saving...' : 'Save Grate ROI'}</span>
            </>
          )}
        </button>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors border border-slate-800 cursor-pointer"
          >
            Done
          </button>
        )}
      </div>

      {saveError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-rose-900/90 border border-rose-500 text-rose-200 text-xs px-4 py-2 rounded-lg flex items-center gap-2 shadow-xl">
          <AlertCircle className="w-4 h-4 text-rose-300" />
          <span>{saveError}</span>
        </div>
      )}
    </div>
  );
};
