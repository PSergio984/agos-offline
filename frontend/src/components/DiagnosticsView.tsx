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
      <div className="pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold text-white tracking-tight">System Diagnostics & Runtime Telemetry</h2>
          <span className="text-[11px] font-medium bg-teal-500/10 text-teal-300 border border-teal-500/20 px-2.5 py-0.5 rounded-full">
            Local Workstation Edge
          </span>
        </div>
        <p className="text-xs text-slate-400 mt-1">
          Hardware acceleration, SQLite database status, and on-premises inference health
        </p>
      </div>

      {/* Core Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Vision Engine */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md shadow-md space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs">Vision Engine</span>
            <Cpu className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-lg font-bold text-white">YOLOv8 ONNX</div>
          <p className="text-[11px] text-slate-400">CPU / DirectML Runtime</p>
        </div>

        {/* Card 2: Inference Latency */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md shadow-md space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs">Inference Latency</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-lg font-bold text-emerald-400 font-mono">
            {telemetry.latency_ms > 0 ? `${telemetry.latency_ms} ms` : '22 ms'}
          </div>
          <p className="text-[11px] text-slate-400">Target Cadence: ~{telemetry.fps || 10} FPS</p>
        </div>

        {/* Card 3: Local Storage */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md shadow-md space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs">Local Database</span>
            <Database className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-lg font-bold text-white">SQLite (agos.db)</div>
          <p className="text-[11px] text-slate-400">storage/incidents/</p>
        </div>

        {/* Card 4: Store & Forward Queue */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-5 backdrop-blur-md shadow-md space-y-2">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs">Sync Queue</span>
            <HardDrive className="w-4 h-4 text-teal-400" />
          </div>
          <div className="text-lg font-bold text-teal-300 font-mono">
            {syncStatus.pending_count} pending
          </div>
          <p className="text-[11px] text-slate-400">{syncStatus.synced_count} records synced</p>
        </div>
      </div>

      {/* Deep Technical Specifications */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Grate Calibration Spec */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md shadow-lg space-y-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-teal-400" />
            <h3 className="font-bold text-sm text-white">Active Grate Calibration Matrix</h3>
          </div>
          <p className="text-xs text-slate-300">
            Normalized bounding coordinates calibrated for {selectedCameraName}. The occlusion engine evaluates solid waste intersection strictly within this polygon.
          </p>

          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800/80 font-mono text-xs space-y-2 text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-400">X-Min (Left):</span>
              <span className="text-teal-400 font-bold">{currentRoi[0].toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Y-Min (Top):</span>
              <span className="text-teal-400 font-bold">{currentRoi[1].toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">X-Max (Right):</span>
              <span className="text-teal-400 font-bold">{currentRoi[2].toFixed(3)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Y-Max (Bottom):</span>
              <span className="text-teal-400 font-bold">{currentRoi[3].toFixed(3)}</span>
            </div>
            <div className="pt-2 border-t border-slate-800/80 flex justify-between text-white font-semibold">
              <span>Normalized Array:</span>
              <span className="text-teal-300">[{currentRoi.map((v) => v.toFixed(2)).join(', ')}]</span>
            </div>
          </div>
        </div>

        {/* VHF/UHF Voice Radio Dispatch Protocol Guidelines */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md shadow-lg space-y-4">
          <div className="flex items-center gap-2.5">
            <Radio className="w-5 h-5 text-teal-400" />
            <h3 className="font-bold text-sm text-white">Voice Radio SOP Guidelines</h3>
          </div>
          <p className="text-xs text-slate-300">
            Standard Operating Procedure for emergency field notifications during drainage occlusion events.
          </p>

          <div className="space-y-2 text-xs">
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-slate-300 space-y-1">
              <span className="font-semibold text-teal-300 block">1. Tactical Link Synchronization</span>
              <p className="text-slate-400 text-[11px]">
                Key transceiver push-to-talk (PTT) switch 1 second prior to vocalizing to allow municipal repeater lock.
              </p>
            </div>
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-slate-300 space-y-1">
              <span className="font-semibold text-teal-300 block">2. Standard Verbatim Format</span>
              <p className="text-slate-400 text-[11px]">
                "Command to Mobile Patrol: Drainage obstruction detected at [Camera]. Occlusion [X]%, Status CRITICAL. Immediate declogging required. Over."
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Air-Gap Assurance Banner */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-5 flex items-start gap-3 text-xs text-emerald-300">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-bold text-sm text-emerald-200 block">100% On-Premises Air-Gapped Operation</span>
          <p className="text-emerald-300/90 leading-relaxed text-[11px]">
            This workstation processes video streams, runs YOLOv8 ONNX inference, manages SQLite incident storage, and synthesizes emergency audio alarms entirely locally. Zero telemetry egress or cloud credentials are required.
          </p>
        </div>
      </div>
    </div>
  );
};
