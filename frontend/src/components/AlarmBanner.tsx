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
    <div className="w-full px-4 sm:px-6 lg:px-8 pt-3 pb-1">
      <div
        className={`max-w-[1720px] mx-auto rounded-2xl p-3 sm:px-5 sm:py-3.5 backdrop-blur-md border shadow-lg transition-all duration-300 ${
          isCritical
            ? 'bg-rose-50/95 border-rose-300 text-rose-950 dark:bg-rose-950/70 dark:border-rose-500/40 dark:text-rose-100 shadow-rose-950/10'
            : 'bg-amber-50/95 border-amber-300 text-amber-950 dark:bg-amber-950/60 dark:border-amber-500/40 dark:text-amber-100 shadow-amber-950/10'
        }`}
      >
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Left: Alarm Status & Message */}
          <div className="flex items-center gap-3.5 flex-1 min-w-0">
            <div
              className={`p-2.5 rounded-xl flex-shrink-0 border shadow-sm ${
                isCritical
                  ? 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-600/20 dark:text-rose-400 dark:border-rose-500/30'
                  : 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/20 dark:text-amber-400 dark:border-amber-500/30'
              }`}
            >
              {isCritical ? <Flame className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full tracking-wide uppercase shadow-sm ${
                    isCritical
                      ? 'bg-rose-600 text-white'
                      : 'bg-amber-500 text-slate-950'
                  }`}
                >
                  {status}
                </span>

                <span className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
                  {occlusionRatio.toFixed(1)}% Occlusion
                </span>

                <span className="text-xs text-slate-600 dark:text-slate-300 hidden sm:inline font-medium">
                  • {cameraName}
                </span>

                {isAcknowledged && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-400 px-2 py-0.5 rounded-full border dark:border-emerald-500/30">
                    <CheckCircle className="w-3 h-3" />
                    Acknowledged
                  </span>
                )}
              </div>

              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 mt-0.5 truncate font-medium">
                {isCritical
                  ? 'Critical drainage obstruction: Grate intake is severely blocked. Immediate clearing required.'
                  : 'Debris accumulating at grate intake. Monitor for rapid water rise.'}
              </p>
            </div>
          </div>

          {/* Right: Action Controls */}
          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto justify-end">
            {/* Siren Toggle */}
            <button
              type="button"
              onClick={handleToggleMute}
              title={isMuted ? 'Unmute Emergency Siren' : 'Mute Emergency Siren'}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
                isMuted
                  ? 'bg-white dark:bg-slate-900/60 border-slate-300 dark:border-slate-700/60 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  : 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/20 dark:border-rose-400/40 dark:text-rose-200 hover:bg-rose-200 dark:hover:bg-rose-500/30'
              }`}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-slate-500" /> : <Volume2 className="w-4 h-4 text-rose-600 dark:text-rose-300 animate-pulse" />}
              <span>{isMuted ? 'Siren Muted' : 'Siren Active'}</span>
            </button>

            {/* Acknowledge Toggle */}
            {!isAcknowledged && (
              <button
                type="button"
                onClick={handleAcknowledge}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700/60 transition-colors shadow-sm cursor-pointer"
              >
                <BellRing className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Acknowledge</span>
              </button>
            )}

            {/* Radio Dispatch Button */}
            {onOpenRadioDispatch && (
              <button
                type="button"
                onClick={onOpenRadioDispatch}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-primary hover:bg-primary/90 text-white border border-teal-500/30 shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Radio className="w-3.5 h-3.5 text-teal-300" />
                <span>Dispatch Radio Team</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
