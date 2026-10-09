import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  CircleCheck,
  TriangleAlert,
  CircleAlert,
  Camera,
  Clock,
  Radio,
  CheckCircle2,
} from 'lucide-react';
import { Incident } from '../types';

interface ReadingDetailModalProps {
  incident: Incident | null;
  isOpen?: boolean;
  onClose: () => void;
  onResolve?: (id: string) => Promise<void> | void;
  onVoiceRadioDispatch?: (incident: Incident) => void;
  isResolving?: boolean;
}

const STATUS_CONFIG = {
  clear: {
    icon: CircleCheck,
    label: 'Clear',
    badge: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 ring-emerald-200 dark:ring-emerald-800/50',
    accent: 'text-emerald-600 dark:text-emerald-400',
    stroke: 'stroke-emerald-500',
  },
  warning: {
    icon: TriangleAlert,
    label: 'Possible Surface Obstruction',
    badge: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 ring-amber-200 dark:ring-amber-800/50',
    accent: 'text-amber-600 dark:text-amber-400',
    stroke: 'stroke-amber-500',
  },
  critical: {
    icon: CircleAlert,
    label: 'Potential Surface Obstruction',
    badge: 'bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 ring-rose-200 dark:ring-rose-800/50',
    accent: 'text-rose-600 dark:text-rose-400',
    stroke: 'stroke-rose-500',
  },
};

function formatDetectionDate(dateInput: string | number | Date): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return String(dateInput);
  }
}

function formatDetectionTime(dateInput: string | number | Date): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  } catch {
    return '';
  }
}

function ProgressRing({ percentage, strokeColor }: { percentage: number; strokeColor: string }) {
  const clamped = Math.min(Math.max(percentage, 0), 100);
  const circumference = 2 * Math.PI * 14;
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <svg width="32" height="32" viewBox="0 0 36 36" className="shrink-0">
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="3.5"
        className="text-slate-200 dark:text-slate-800"
      />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        strokeWidth="3.5"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
        className={`${strokeColor} transition-all duration-500`}
      />
    </svg>
  );
}

export const ReadingDetailModal: React.FC<ReadingDetailModalProps> = ({
  incident,
  isOpen = true,
  onClose,
  onResolve,
  onVoiceRadioDispatch,
  isResolving = false,
}) => {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!incident || !isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      if (typeof document !== 'undefined') {
        document.body.style.overflow = 'unset';
        document.removeEventListener('keydown', handleKeyDown);
      }
    };
  }, [incident, isOpen, onClose]);

  if (!incident || !isOpen) {
    return null;
  }

  const statusKey: 'clear' | 'warning' | 'critical' =
    incident.status === 'CLEAR'
      ? 'clear'
      : incident.status === 'WARNING'
      ? 'warning'
      : 'critical';

  const config = STATUS_CONFIG[statusKey];
  const StatusIcon = config.icon;

  const detectedDateStr = incident.timestamp;
  const recordedDateStr =
    incident.dispatched_at ||
    incident.timestamp;

  const modalContent = (
    <div
      className="fixed inset-0 bg-slate-950/70 backdrop-blur-md flex items-center justify-center z-50 p-4 transition-all animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reading-detail-title"
    >
      <div
        className="bg-white dark:bg-[#0B1526] rounded-2xl shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto border border-slate-200 dark:border-slate-800 transition-colors flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3 border-b border-slate-100 dark:border-slate-800/80">
          <div className="flex items-center gap-3 min-w-0 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ring-1 shadow-sm ${config.badge}`}
            >
              <StatusIcon className="w-3.5 h-3.5" />
              <span>{config.label}</span>
            </span>
            <span id="reading-detail-title" className="text-sm font-semibold text-slate-500 dark:text-slate-400 font-mono">
              Detection #{incident.id}
            </span>
            {incident.action_taken && (
              <span
                className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border ${
                  incident.action_taken === 'RESOLVED'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20'
                    : 'bg-teal-50 text-teal-700 border-teal-300 dark:bg-teal-500/10 dark:text-teal-300 dark:border-teal-500/20'
                }`}
              >
                {incident.action_taken}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close detection detail"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Center Preview: Large snapshot with bounding box annotations */}
        <div className="px-6 pt-5">
          <div className="relative w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 min-h-[300px] max-h-[50vh] flex items-center justify-center group">
            {imageError || !incident.snapshot_url ? (
              <div className="w-full min-h-[300px] flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-slate-900 to-slate-950 text-slate-400">
                <div className="relative mb-3">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center border border-slate-700">
                    <Camera className="w-8 h-8 text-teal-400" />
                  </div>
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-teal-500" />
                  </span>
                </div>
                <h4 className="font-semibold text-sm text-slate-200">
                  {incident.camera_name}
                </h4>
                <p className="text-xs text-slate-400 max-w-sm mt-1">
                  Culvert drainage surveillance capture recorded at {incident.location}.
                </p>
                {incident.debris_types && incident.debris_types.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 justify-center mt-3 max-w-md">
                    {incident.debris_types.map((debris, idx) => (
                      <span
                        key={idx}
                        className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800/80 border border-slate-700 text-teal-300 font-mono"
                      >
                        {debris}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                <img
                  src={incident.snapshot_url}
                  alt={`Detection #${incident.id}`}
                  className="max-h-[50vh] w-full object-contain"
                  onError={() => setImageError(true)}
                />
                {/* Visual Bounding Overlay Tag */}
                <div className="absolute top-3 right-3 bg-slate-950/80 backdrop-blur-md px-3 py-1 rounded-lg border border-slate-700 text-xs font-mono text-teal-300">
                  AI Annotated Bounding Boxes
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 4 Bottom Metric Cards (2x2 grid) */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Metric 1: VISIBLE SURFACE COVERAGE */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 flex flex-col justify-between border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
                  Visible Surface Coverage
                </span>
                <ProgressRing
                  percentage={incident.occlusion_ratio}
                  strokeColor={config.stroke}
                />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-slate-100 font-mono tracking-tight">
                  {incident.occlusion_ratio.toFixed(1)}%
                </span>
                <span className={`text-xs font-semibold ${config.accent}`}>
                  ({config.label})
                </span>
              </div>
            </div>

            {/* Metric 2: CAMERA */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 flex flex-col justify-between border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
                  Camera
                </span>
                <div className="p-1.5 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  <Camera className="w-4 h-4" />
                </div>
              </div>
              <div>
                <span className="text-base font-bold text-slate-900 dark:text-slate-100 truncate block">
                  {incident.camera_name}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 truncate block mt-0.5">
                  {incident.location}
                </span>
              </div>
            </div>

            {/* Metric 3: DETECTED */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 flex items-center gap-3.5 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                <Clock className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
                  Detected
                </p>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                  {formatDetectionDate(detectedDateStr)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {formatDetectionTime(detectedDateStr) || detectedDateStr}
                </p>
              </div>
            </div>

            {/* Metric 4: RECORDED */}
            <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl p-4 flex items-center gap-3.5 border border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                <CheckCircle2 className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider font-mono">
                  Recorded
                </p>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">
                  {formatDetectionDate(recordedDateStr)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {formatDetectionTime(recordedDateStr) || recordedDateStr}
                </p>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
            {incident.action_taken !== 'RESOLVED' && onResolve && (
              <button
                type="button"
                disabled={isResolving}
                onClick={() => onResolve(incident.id)}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-emerald-950/20 cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isResolving ? 'Resolving...' : 'Mark as Resolved'}</span>
              </button>
            )}

            {onVoiceRadioDispatch && (
              <button
                type="button"
                onClick={() => {
                  onVoiceRadioDispatch(incident);
                  onClose();
                }}
                className="px-4 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all shadow-md shadow-primary/20 cursor-pointer"
              >
                <Radio className="w-4 h-4 text-teal-300" />
                <span>Voice Radio Dispatch</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
};

export default ReadingDetailModal;
