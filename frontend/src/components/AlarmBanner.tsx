import React, { useEffect, useState } from 'react';
import { OcclusionStatus } from '../types';
import { sirenSynthesizer } from '../services/audioSiren';
import {
  AlertTriangle,
  Flame,
  Volume2,
  VolumeX,
  CheckCircle,
  Radio,
  BellRing,
} from 'lucide-react';

interface AlarmBannerProps {
  status: OcclusionStatus;
  occlusionRatio: number;
  cameraName: string;
  onOpenRadioDispatch?: () => void;
}

export const AlarmBanner: React.FC<AlarmBannerProps> = ({
  status,
  occlusionRatio,
  cameraName,
  onOpenRadioDispatch,
}) => {
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isAcknowledged, setIsAcknowledged] = useState<boolean>(false);
  const [audioStarted, setAudioStarted] = useState<boolean>(false);

  const isCritical = status === 'CRITICAL' || status === 'CRITICAL BLOCKED';
  const isWarning = status === 'WARNING';
  const isAlarmActive = isCritical || isWarning;

  // Reset acknowledgment if status drops back to CLEAR
  useEffect(() => {
    if (!isAlarmActive) {
      setIsAcknowledged(false);
      sirenSynthesizer.stop();
    }
  }, [isAlarmActive]);

  // Manage Web Audio Siren based on status, mute, and acknowledgment
  useEffect(() => {
    if (!audioStarted) return;

    if (isAcknowledged || isMuted || !isAlarmActive) {
      sirenSynthesizer.stop();
      return;
    }

    if (isCritical) {
      sirenSynthesizer.playCriticalSiren();
    } else if (isWarning) {
      sirenSynthesizer.playWarningChime();
    }

    return () => {
      sirenSynthesizer.stop();
    };
  }, [isCritical, isWarning, isMuted, isAcknowledged, isAlarmActive, audioStarted]);

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    sirenSynthesizer.setMuted(nextMuted);
    setAudioStarted(true);
  };

  const handleAcknowledge = () => {
    setIsAcknowledged(true);
    sirenSynthesizer.stop();
    sirenSynthesizer.playRadioClick();
  };

  // If status is CLEAR, don't show the emergency alarm banner
  if (!isAlarmActive) {
    return null;
  }

  return (
    <div
      className={`w-full transition-all duration-300 z-40 border-b shadow-xl ${
        isCritical
          ? 'bg-rose-950/95 border-rose-500 text-rose-50 animate-alarm-glow'
          : 'bg-amber-950/95 border-amber-500 text-amber-50 animate-warning-glow'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Left: Alarm Status & Message */}
          <div className="flex items-center gap-3.5 flex-1 min-w-0">
            <div
              className={`p-2 rounded-lg flex-shrink-0 animate-bounce ${
                isCritical ? 'bg-rose-600 text-white shadow-lg shadow-rose-900/50' : 'bg-amber-500 text-slate-950'
              }`}
            >
              {isCritical ? <Flame className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs uppercase font-mono font-extrabold px-2 py-0.5 rounded tracking-wider ${
                    isCritical ? 'bg-rose-600 text-white' : 'bg-amber-500 text-slate-950'
                  }`}
                >
                  {status}
                </span>

                <span className="font-mono text-sm font-bold text-white">
                  OCCLUSION: {occlusionRatio.toFixed(1)}%
                </span>

                <span className="text-xs text-white/70 font-mono hidden sm:inline">
                  • {cameraName}
                </span>

                {isAcknowledged && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono bg-slate-900/80 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/50">
                    <CheckCircle className="w-3 h-3" />
                    ACKNOWLEDGED BY DESK
                  </span>
                )}
              </div>

              <p className="text-xs sm:text-sm text-slate-200 mt-0.5 truncate font-medium">
                {isCritical
                  ? 'CRITICAL DRAINAGE OBSTRUCTION: Grate opening severely occluded by solid waste. Immediate mobile patrol dispatch required.'
                  : 'ACCUMULATING DEBRIS WARNING: Solid waste obstructing grate intake. Monitor for rapid rise or queue clearance.'}
              </p>
            </div>
          </div>

          {/* Right: Quick Action Controls */}
          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
            {/* Audio Siren Enable/Mute Toggle */}
            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute Emergency Siren' : 'Mute Emergency Siren'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-all border ${
                isMuted
                  ? 'bg-slate-900/80 border-slate-700 text-slate-400 hover:text-white'
                  : 'bg-rose-900/80 border-rose-400 text-rose-200 hover:bg-rose-800'
              }`}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-rose-300 animate-pulse" />}
              <span>{isMuted ? 'SIREN MUTED' : 'SIREN ACTIVE'}</span>
            </button>

            {/* Acknowledge Toggle */}
            {!isAcknowledged && (
              <button
                type="button"
                onClick={handleAcknowledge}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-900/80 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700 transition-colors shadow-sm"
              >
                <BellRing className="w-4 h-4 text-amber-400" />
                <span>Acknowledge</span>
              </button>
            )}

            {/* VHF/UHF Voice Radio Dispatch Button */}
            {onOpenRadioDispatch && (
              <button
                type="button"
                onClick={onOpenRadioDispatch}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400 shadow-md shadow-cyan-950/50 transition-all hover:scale-105"
              >
                <Radio className="w-4 h-4 text-cyan-100" />
                <span>Radio Dispatch Ticket</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
