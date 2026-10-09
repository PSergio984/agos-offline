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
    badge: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 ring-red-200 dark:ring-red-800/50',
    accent: 'text-red-600 dark:text-red-400',
    stroke: 'stroke-red-500',
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

  const normalizedStatus = (incident.status || '').toUpperCase();
  const statusKey: 'clear' | 'warning' | 'critical' =
    normalizedStatus === 'CLEAR'
      ? 'clear'
      : normalizedStatus === 'WARNING'
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
      className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-colors animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="reading-detail-title"
    >
      <div
        className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-y-auto custom-scrollbar border border-white/10 dark:border-slate-800 transition-colors flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
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
                    : 'bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/20'
                }`}
              >
                {incident.action_taken}
              </span>
            )}
            {incident.radio_ticket && (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 font-mono">
                Ticket {incident.radio_ticket}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1.5 rounded-full text-gray-500 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 hover:text-gray-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
            aria-label="Close detection detail"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Center Preview: Large snapshot with bounding box annotations */}
        <div className="px-5 pt-4">
          <div className="relative w-full bg-gray-100 dark:bg-slate-950 rounded-lg overflow-hidden border border-gray-200 dark:border-slate-800 min-h-72 max-h-[50vh] flex items-center justify-center group">
            {imageError || !incident.snapshot_url ? (
              <div className="w-full min-h-72 flex flex-col items-center justify-center p-8 text-center bg-gradient-to-b from-slate-900 to-slate-950 text-slate-400">
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
                {((typeof incident.debris_count === 'number' && incident.debris_count > 0) ||
                  statusKey !== 'clear' ||
                  incident.occlusion_ratio > 0) && (
                  <div className="flex flex-wrap gap-1.5 justify-center mt-3 max-w-md">
                    <span className="px-2.5 py-1 text-[11px] rounded-lg bg-slate-800/80 border border-slate-700 text-teal-300 font-mono">
                      {typeof incident.debris_count === 'number' && incident.debris_count > 0
                        ? `${incident.debris_count} Detected Debris`
                        : 'Debris Obstruction'}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="w-full bg-gray-100 dark:bg-slate-950 flex items-center justify-center overflow-auto">
                <img
                  src={incident.snapshot_url}
                  alt={`Detection #${incident.id}`}
                  className="max-h-[58vh] w-full object-contain"
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
        <div className="p-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Metric 1: VISIBLE SURFACE COVERAGE */}
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-3.5 flex flex-col gap-2 border border-transparent dark:border-slate-700/50">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[0.68rem] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wide">
                    Visible Surface Coverage
                  </span>
                  <span className="text-[10px] text-primary dark:text-blue-400 font-medium">
                    (Trash Blockage Level)
                  </span>
                </div>
                <ProgressRing
                  percentage={incident.occlusion_ratio}
                  strokeColor={config.stroke}
                />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-gray-800 dark:text-slate-200">
                  {incident.occlusion_ratio.toFixed(1)}%
                </span>
                <span className={`text-xs font-semibold ${config.accent}`}>
                  ({config.label})
                </span>
              </div>
            </div>

            {/* Metric 2: CAMERA */}
            <div className="bg-gray-50 dark:bg-slate-800/50 rounded-xl p-3.5 flex flex-col gap-2 border border-transparent dark:border-slate-700/50">
              <div className="flex items-center justify-between">
                <span className="text-[0.68rem] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wide">
                  Camera
                </span>
                <Camera className="w-5 h-5 text-gray-500 dark:text-slate-400" />
              </div>
              <div>
                <span className="text-xl font-bold text-gray-800 dark:text-slate-200 truncate block">
                  {incident.camera_name}
                </span>
                <span className="text-[0.68rem] text-gray-400 dark:text-slate-500 truncate block">
                  {incident.location}
                </span>
              </div>
            </div>
          </div>

          {/* Timestamps */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 bg-gray-50 dark:bg-slate-800/50 rounded-xl px-3.5 py-3 flex items-center gap-3 border border-transparent dark:border-slate-700/50">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200/70 dark:bg-slate-700 text-gray-500 dark:text-slate-400 shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.68rem] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wide">
                  Detected
                </p>
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-300 truncate">
                  {formatDetectionDate(detectedDateStr)}
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-500 font-mono">
                  {formatDetectionTime(detectedDateStr) || detectedDateStr}
                </p>
              </div>
            </div>

            <div className="flex-1 bg-gray-50 dark:bg-slate-800/50 rounded-xl px-3.5 py-3 flex items-center gap-3 border border-transparent dark:border-slate-700/50">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-gray-200/70 dark:bg-slate-700 text-gray-500 dark:text-slate-400 shrink-0">
                <Clock className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.68rem] font-medium text-gray-400 dark:text-slate-500 uppercase tracking-wide">
                  Recorded
                </p>
                <p className="text-sm font-semibold text-gray-700 dark:text-slate-300 truncate">
                  {formatDetectionDate(recordedDateStr)}
                </p>
                <p className="text-xs text-gray-400 dark:text-slate-500 font-mono">
                  {formatDetectionTime(recordedDateStr) || recordedDateStr}
                </p>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="pt-3 border-t border-gray-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
            {incident.action_taken !== 'RESOLVED' && onResolve && (
              <button
                type="button"
                disabled={isResolving}
                onClick={() => onResolve(incident.id)}
                className="btn-custom bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/20 disabled:opacity-50"
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
                className="btn-custom bg-primary hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 text-white shadow-md shadow-primary/20"
              >
                <Radio className="w-4 h-4" />
                <span>Voice Radio Dispatch</span>
              </button>
            )}

            <button type="button" onClick={onClose} className="btn-cancel">
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
