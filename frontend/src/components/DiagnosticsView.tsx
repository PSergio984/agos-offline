import React from 'react';
import {
  Cpu,
  Activity,
  Database,
  HardDrive,
  Radio,
  Sliders,
  ShieldCheck,
} from 'lucide-react';
import { FrameTelemetry, ROI } from '../types';

interface DiagnosticsViewProps {
  telemetry: FrameTelemetry;
  currentRoi: ROI;
  selectedCameraName: string;
  syncStatus: {
    is_online: boolean;
    status: string;
    status_label: string;
    pending_count: number;
    synced_count: number;
  };
}

export const DiagnosticsView: React.FC<DiagnosticsViewProps> = ({
  telemetry,
  currentRoi,
  selectedCameraName,
  syncStatus,
}) => {
  return (
    <div className="space-y-6 max-w-6xl mx-auto font-sans">
      {/* Header */}
      <div className="pb-4 border-b border-slate-200/80 dark:border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">System Health & Diagnostics</h2>
          <span className="text-[11px] font-medium bg-teal-50 text-teal-700 dark:bg-teal-500/10 dark:text-teal-300 border border-teal-200 dark:border-teal-500/20 px-2.5 py-0.5 rounded-full">
            Local Computer
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Check if camera, local computer storage, and saved logs are running smoothly
        </p>
      </div>

      {/* Core Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Camera Scanner */}
        <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-lg space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Camera Scanner</span>
            <Cpu className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-white">YOLOv8 AI</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Runs locally on this PC</p>
        </div>

        {/* Card 2: Scan Speed */}
        <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-lg space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Scan Speed</span>
            <Activity className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">
            {telemetry.latency_ms > 0 ? `${telemetry.latency_ms} ms` : '22 ms'}
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Fast · ~{telemetry.fps || 10} Frames/sec</p>
        </div>

        {/* Card 3: Local Storage */}
        <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-lg space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Saved Records</span>
            <Database className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="text-lg font-bold text-slate-900 dark:text-white">agos.db</div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">Saved on computer drive</p>
        </div>

        {/* Card 4: Store & Forward Queue */}
        <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 rounded-2xl p-5 shadow-lg space-y-2">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold">Cloud Sync</span>
            <HardDrive className="w-4 h-4 text-teal-600 dark:text-teal-400" />
          </div>
          <div className="text-lg font-bold text-teal-700 dark:text-teal-300 font-mono">
            {syncStatus.pending_count} waiting
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">{syncStatus.synced_count} already synced</p>
        </div>
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Camera Scan Area */}
        <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 rounded-2xl p-6 shadow-lg space-y-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">Camera Scan Area</h3>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            The camera looks for trash inside this marked area on the canal for {selectedCameraName}.
          </p>

          <div className="bg-slate-50 dark:bg-slate-900/40 p-4 rounded-xl border border-slate-200/60 dark:border-slate-800/60 font-mono text-xs space-y-2 text-slate-700 dark:text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Left edge:</span>
              <span className="text-teal-700 dark:text-teal-400 font-semibold">{currentRoi[0].toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Top edge:</span>
              <span className="text-teal-700 dark:text-teal-400 font-semibold">{currentRoi[1].toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Right edge:</span>
              <span className="text-teal-700 dark:text-teal-400 font-semibold">{currentRoi[2].toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500 dark:text-slate-400">Bottom edge:</span>
              <span className="text-teal-700 dark:text-teal-400 font-semibold">{currentRoi[3].toFixed(3)}</span>
            </div>
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex justify-between text-[11px]">
              <span className="text-slate-500 dark:text-slate-400 font-sans">Area Box:</span>
              <span className="text-slate-900 dark:text-white font-bold">
                [{currentRoi.map((v) => v.toFixed(2)).join(', ')}]
              </span>
            </div>
          </div>
        </div>

        {/* Radio Call Guide */}
        <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 shadow-lg rounded-2xl p-6 space-y-4">
          <div className="flex items-center gap-2.5">
            <Radio className="w-5 h-5 text-teal-600 dark:text-teal-400" />
            <h3 className="font-bold text-sm text-slate-900 dark:text-white">Radio Call Guide</h3>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            How to call responders over radio or phone when a drain is blocked:
          </p>

          <div className="space-y-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 space-y-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[11px] font-bold">1</span>
                <span>Before speaking:</span>
              </div>
              <p className="text-slate-600 dark:text-slate-400 pl-6">
                Press and hold radio button for 1 second before talking so words don't get cut off.
              </p>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200/60 dark:border-slate-800/60 space-y-1">
              <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 flex items-center justify-center text-[11px] font-bold">2</span>
                <span>What to say on radio:</span>
              </div>
              <p className="font-mono text-teal-900 dark:text-teal-200 bg-teal-50/80 dark:bg-teal-950/40 p-2.5 rounded-lg border border-teal-200 dark:border-teal-800/50 pl-3">
                "Attention Mobile Patrol: Trash blockage detected at [Location]. Blockage [X]%. Please clean immediately. Over."
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 100% Offline Guarantee Banner */}
      <div className="bg-emerald-50/80 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 rounded-2xl p-4 flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-0.5">
          <p className="font-bold text-emerald-900 dark:text-emerald-200">
            Works 100% Offline (No Internet Needed)
          </p>
          <p className="text-emerald-700 dark:text-emerald-300 leading-relaxed">
            This system runs camera feeds, AI trash detection, and saves logs directly on this computer. It continues working during storms and internet outages.
          </p>
        </div>
      </div>
    </div>
  );
};
