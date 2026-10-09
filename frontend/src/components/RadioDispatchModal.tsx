import React, { useState } from 'react';
import { Copy, Check, Radio, Mic, X, Send, MapPin, AlertCircle, Volume2 } from 'lucide-react';
import { sirenSynthesizer } from '../services/audioSiren';

interface RadioDispatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameraName: string;
  cameraId: string;
  location?: string;
  occlusionRatio: number;
  status: string;
  debrisTypes?: string[];
  onDispatched?: () => void;
  rainHazard?: boolean;
}

export const RadioDispatchModal: React.FC<RadioDispatchModalProps> = ({
  isOpen,
  onClose,
  cameraName,
  location = 'Brgy. San Jose, Rizal Ave cor. Mabini St.',
  occlusionRatio,
  status,
  debrisTypes = ['Plastic Sacks', 'Vegetative Cluster', 'Styrofoam'],
  onDispatched,
  rainHazard = false,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [selectedChannel, setSelectedChannel] = useState<string>('CH-14 (156.700 MHz DRRMO Tac 1)');
  const [patrolUnit, setPatrolUnit] = useState<string>('Mobile Patrol Unit 4 (Tango-4)');
  const [dispatchedSuccess, setDispatchedSuccess] = useState<boolean>(false);

  if (!isOpen) return null;

  // The pre-formatted verbal script as specified in the task prompt:
  // "Command to Mobile Patrol: Drainage obstruction detected at [Camera Name]. Occlusion [X]%, Status CRITICAL. Immediate declogging required. Over."
  const radioScript = `Command to ${patrolUnit.split(' ')[0]} ${patrolUnit.split(' ')[1] || 'Mobile Patrol'}: Drainage obstruction detected at ${cameraName}. Occlusion ${occlusionRatio.toFixed(1)}%, Status ${status}. Immediate declogging required. Over.`;

  const handleCopy = async () => {
    sirenSynthesizer.playRadioClick();
    try {
      await navigator.clipboard.writeText(radioScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API is blocked
      const textArea = document.createElement('textarea');
      textArea.value = radioScript;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleMarkDispatched = () => {
    sirenSynthesizer.playRadioClick();
    setDispatchedSuccess(true);
    if (onDispatched) onDispatched();
    setTimeout(() => {
      setDispatchedSuccess(false);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white dark:bg-[#0B1526] border border-slate-200 dark:border-slate-700/70 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col font-sans text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header */}
        <div className="p-4 sm:px-6 border-b border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary/10 dark:bg-primary/30 text-primary dark:text-teal-400 rounded-xl border border-primary/20 dark:border-teal-500/30 shadow-sm">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-primary dark:text-white text-base tracking-tight">
                  Voice Radio Dispatch Ticket
                </h3>
                <span className="text-[10px] font-semibold bg-teal-50 text-teal-800 dark:bg-teal-500/10 dark:text-teal-300 border border-teal-200 dark:border-teal-500/20 px-2 py-0.5 rounded-full">
                  Two-Way Tactical
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                LGU Disaster Risk Reduction & Management Emergency Channel
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 sm:p-6 space-y-4 text-sm text-slate-700 dark:text-slate-200">
          {/* Tactical Channel & Unit Config */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1.5">
                Radio Frequency / Channel:
              </label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full bg-white dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2 text-xs focus:border-teal-500 focus:outline-none shadow-sm cursor-pointer"
              >
                <option value="CH-14 (156.700 MHz DRRMO Tac 1)">CH-14 (156.700 MHz DRRMO Tac 1)</option>
                <option value="CH-08 (152.225 MHz Barangay Net)">CH-08 (152.225 MHz Barangay Net)</option>
                <option value="CH-03 (148.550 MHz DPWH/Engineering)">CH-03 (148.550 MHz DPWH/Engineering)</option>
                <option value="CH-01 (155.000 MHz City Emergency Call)">CH-01 (155.000 MHz City Emergency Call)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-400 mb-1.5">
                Assigned Responder Unit:
              </label>
              <select
                value={patrolUnit}
                onChange={(e) => setPatrolUnit(e.target.value)}
                className="w-full bg-white dark:bg-slate-950/80 border border-slate-300 dark:border-slate-800 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-2 text-xs focus:border-teal-500 focus:outline-none shadow-sm cursor-pointer"
              >
                <option value="Mobile Patrol Unit 4 (Tango-4)">Mobile Patrol Unit 4 (Tango-4)</option>
                <option value="Barangay San Jose Tanod Quick Response">Barangay San Jose Tanod Quick Response</option>
                <option value="City Engineering Declogging Crew Alpha">City Engineering Declogging Crew Alpha</option>
                <option value="BFP Drainage Rescue Unit 2">BFP Drainage Rescue Unit 2</option>
              </select>
            </div>
          </div>

          {/* Incident Snapshot Summary */}
          <div className="bg-slate-50 dark:bg-slate-950/50 rounded-xl p-3.5 border border-slate-200 dark:border-slate-800/80 text-xs space-y-2">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="flex items-center gap-1.5 font-medium">
                <MapPin className="w-3.5 h-3.5 text-primary dark:text-teal-400" />
                <span>Location:</span>
              </span>
              <span className="text-slate-900 dark:text-white font-semibold">{location}</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="font-medium">Occlusion Ratio:</span>
              <span className="text-rose-600 dark:text-rose-400 font-bold">{occlusionRatio.toFixed(1)}% ({status})</span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span className="font-medium">Detected Debris:</span>
              <span className="text-amber-700 dark:text-amber-300 font-semibold">{debrisTypes.join(', ') || 'Solid waste cluster'}</span>
            </div>
          </div>

          {/* Pre-Formatted Verbal Radio Script (Primary Focus) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-bold text-teal-800 dark:text-teal-300">
                <Mic className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                <span>Verbal Radio Script (Read on Air)</span>
              </label>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 font-medium">
                <Volume2 className="w-3 h-3 text-slate-400" />
                Standard Voice SOP
              </span>
            </div>

            <div className="relative group">
              <div className="w-full bg-teal-50/90 dark:bg-slate-950/90 p-4 rounded-xl border border-teal-200 dark:border-teal-500/30 text-teal-950 dark:text-teal-100 font-mono text-xs sm:text-sm leading-relaxed shadow-sm">
                "{radioScript}"
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary hover:bg-primary/90 text-white text-xs font-semibold transition-all shadow-md active:scale-95 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-teal-300" />
                    <span>Copy Script</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {rainHazard && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-rose-50 dark:bg-rose-950/40 p-3 rounded-xl border border-rose-300 dark:border-rose-800 text-[11px] text-rose-900 dark:text-rose-200 font-semibold"
            >
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5" />
              <p>Rain hazard: heavy rainfall reported. Confirm responder safety before sending crews to the drain.</p>
            </div>
          )}

          {/* Operator Instructions Banner */}
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-slate-950/40 p-3 rounded-xl border border-amber-200 dark:border-slate-800/80 text-[11px] text-amber-900 dark:text-slate-400 font-medium">
            <AlertCircle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <p>
              Hold mic 5cm away. Key PTT switch for 1 second before speaking to allow repeater synchronization. Confirm unit callsign upon acknowledgment.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 sm:px-6 bg-slate-50 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800/80 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white border border-slate-300 dark:border-slate-800 transition-colors cursor-pointer shadow-sm"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-teal-700 dark:text-teal-300 border border-slate-300 dark:border-slate-800 transition-colors cursor-pointer shadow-sm"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              type="button"
              onClick={handleMarkDispatched}
              disabled={dispatchedSuccess}
              className={`flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold text-white transition-all shadow-md cursor-pointer ${
                dispatchedSuccess
                  ? 'bg-emerald-600'
                  : 'bg-primary hover:bg-primary/90'
              }`}
            >
              {dispatchedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Logged in Queue</span>
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5 text-teal-300" />
                  <span>Mark Unit Dispatched</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
