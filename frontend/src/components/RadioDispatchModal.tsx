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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-eoc-dark border border-cyan-500/50 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-eoc-card to-slate-900 p-4 border-b border-slate-700/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-cyan-950 text-cyan-400 rounded-xl border border-cyan-500/40">
              <Radio className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base tracking-wide">
                  VHF / UHF Voice Radio Dispatch
                </h3>
                <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded">
                  TWO-WAY TACTICAL
                </span>
              </div>
              <p className="text-xs text-slate-400">
                LGU Disaster Risk Reduction & Management Emergency Voice Channel
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4 text-sm text-slate-200">
          {/* Tactical Channel & Unit Config */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">
                Radio Frequency / Channel:
              </label>
              <select
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="CH-14 (156.700 MHz DRRMO Tac 1)">CH-14 (156.700 MHz DRRMO Tac 1)</option>
                <option value="CH-08 (152.225 MHz Barangay Net)">CH-08 (152.225 MHz Barangay Net)</option>
                <option value="CH-03 (148.550 MHz DPWH/Engineering)">CH-03 (148.550 MHz DPWH/Engineering)</option>
                <option value="CH-01 (155.000 MHz City Emergency Call)">CH-01 (155.000 MHz City Emergency Call)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1">
                Assigned Responder Unit:
              </label>
              <select
                value={patrolUnit}
                onChange={(e) => setPatrolUnit(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg px-3 py-2 text-xs font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="Mobile Patrol Unit 4 (Tango-4)">Mobile Patrol Unit 4 (Tango-4)</option>
                <option value="Barangay San Jose Tanod Quick Response">Barangay San Jose Tanod Quick Response</option>
                <option value="City Engineering Declogging Crew Alpha">City Engineering Declogging Crew Alpha</option>
                <option value="BFP Drainage Rescue Unit 2">BFP Drainage Rescue Unit 2</option>
              </select>
            </div>
          </div>

          {/* Incident Snapshot Summary */}
          <div className="bg-slate-900/80 rounded-xl p-3 border border-slate-800 text-xs space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-cyan-400" />
                <span>LOCATION:</span>
              </span>
              <span className="text-white font-semibold">{location}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>OCCLUSION RATIO:</span>
              <span className="text-rose-400 font-bold">{occlusionRatio.toFixed(1)}% ({status})</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>DETECTED DEBRIS:</span>
              <span className="text-amber-300">{debrisTypes.join(', ') || 'Solid waste cluster'}</span>
            </div>
          </div>

          {/* Pre-Formatted Verbal Radio Script (Primary Focus) */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cyan-300">
                <Mic className="w-4 h-4 text-cyan-400" />
                <span>Verbal Radio Script (Standard Operating Procedure)</span>
              </label>
              <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                <Volume2 className="w-3 h-3 text-slate-500" />
                Read verbatim on transceiver
              </span>
            </div>

            <div className="relative group">
              <div className="w-full bg-slate-950 p-4 rounded-xl border border-cyan-500/50 text-cyan-100 font-mono text-sm leading-relaxed shadow-inner">
                "{radioScript}"
              </div>

              <button
                type="button"
                onClick={handleCopy}
                className="absolute top-2.5 right-2.5 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/90 hover:bg-cyan-500 text-white text-xs font-bold transition-all shadow-md active:scale-95"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Radio Script</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Operator Instructions Banner */}
          <div className="flex items-start gap-2 bg-slate-900/60 p-2.5 rounded-lg border border-slate-800 text-[11px] text-slate-400">
            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p>
              Hold mic 5cm away. Key PTT transmitter switch for 1 second before vocalizing to allow repeater link synchronization. Ensure patrol acknowledges with call sign.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-cyan-300 hover:text-cyan-200 border border-slate-700 transition-colors"
            >
              <Copy className="w-4 h-4" />
              <span>{copied ? 'Copied to Clipboard!' : 'Copy Script'}</span>
            </button>

            <button
              type="button"
              onClick={handleMarkDispatched}
              disabled={dispatchedSuccess}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-bold text-white transition-all shadow-lg ${
                dispatchedSuccess
                  ? 'bg-emerald-600 shadow-emerald-900/40'
                  : 'bg-cyan-600 hover:bg-cyan-500 shadow-cyan-900/40 hover:scale-102'
              }`}
            >
              {dispatchedSuccess ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>Logged in Dispatched Queue!</span>
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
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
