import React, { useState } from 'react';
import { StreamSource, StreamSourceType } from '../types';
import { switchStream } from '../services/api';
import { Camera, Network, Play, Check } from 'lucide-react';

interface StreamSelectorProps {
  cameraId: string;
  activeSource: StreamSource;
  onSourceChange: (source: StreamSource) => void;
}

const PRESET_SOURCES: StreamSource[] = [
  {
    id: 'real-validation-demo',
    type: 'demo',
    name: 'Real Demo (Validation Set)',
    description: 'sample_media/jionco_val_demo.mp4 (150 real-world images)',
    url: 'sample_media/jionco_val_demo.mp4',
  },
  {
    id: 'miniature-rain-demo',
    type: 'demo',
    name: 'Real Demo (Miniature Rain)',
    description: 'sample_media/miniature_rain_demo.mp4 (50 wet conditions images)',
    url: 'sample_media/miniature_rain_demo.mp4',
  },
  {
    id: 'usb-webcam',
    type: 'webcam',
    name: 'USB Webcam',
    description: 'Direct local USB video device (index 0)',
    device_index: 0,
  },
  {
    id: 'rtsp-stream',
    type: 'rtsp',
    name: 'Local RTSP Stream',
    description: 'Municipal CCTV IP Camera feed',
    url: 'rtsp://admin:admin@192.168.1.100:554/live',
  },
];

export const StreamSelector: React.FC<StreamSelectorProps> = ({
  cameraId,
  activeSource,
  onSourceChange,
}) => {
  const [selectedType, setSelectedType] = useState<StreamSourceType>(activeSource.type);
  const [customRtspUrl, setCustomRtspUrl] = useState<string>(activeSource.url || '');
  const [webcamIndex, setWebcamIndex] = useState<number>(activeSource.device_index ?? 0);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSelectPreset = async (preset: StreamSource) => {
    setSelectedType(preset.type);
    setIsSwitching(true);
    setStatusMessage(null);

    try {
      await switchStream(cameraId, preset);

      onSourceChange(preset);
      setStatusMessage(`Switched to ${preset.name}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage(`Failed connecting to ${preset.name}`);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleApplyCustomRtsp = async () => {
    if (!customRtspUrl) return;
    setIsSwitching(true);
    setStatusMessage(null);

    const updatedSource: StreamSource = {
      id: 'rtsp-custom',
      type: 'rtsp',
      name: 'Custom RTSP Stream',
      description: customRtspUrl,
      url: customRtspUrl,
    };

    try {
      await switchStream(cameraId, updatedSource);

      onSourceChange(updatedSource);
      setStatusMessage(`Active: ${customRtspUrl}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage('Failed connecting to custom RTSP stream');
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl border border-slate-200/80 dark:border-white/10 shadow-lg rounded-2xl p-3 sm:p-4 transition-colors">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Source Switcher Segmented Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-white/[0.04] p-1 rounded-xl border border-slate-200/80 dark:border-white/10 overflow-x-auto">
          {PRESET_SOURCES.map((source) => {
            const isActive =
              activeSource.type === source.type &&
              (source.type !== 'rtsp' || activeSource.id === source.id);
            const Icon =
              source.type === 'demo' ? Play : source.type === 'webcam' ? Camera : Network;

            return (
              <button
                key={source.id}
                type="button"
                onClick={() => handleSelectPreset(source)}
                disabled={isSwitching}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-primary text-white shadow-sm font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-white/[0.06]'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-teal-300' : 'text-slate-500 dark:text-slate-400'}`} />
                <span>{source.name}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>

        {/* Status Notification */}
        {statusMessage && (
          <div className="flex items-center gap-1.5 text-xs text-teal-800 dark:text-teal-300 bg-teal-50 dark:bg-teal-500/10 px-3 py-1 rounded-full border border-teal-200 dark:border-teal-500/20">
            <Check className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Contextual Configuration Row for RTSP & Webcam */}
      {selectedType === 'rtsp' && (
        <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-white/10 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={customRtspUrl}
            onChange={(e) => setCustomRtspUrl(e.target.value)}
            placeholder="rtsp://admin:password@192.168.1.100:554/stream1"
            className="flex-1 bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 text-slate-800 dark:text-slate-100 rounded-xl px-3 py-1.5 text-xs focus:border-teal-500 focus:outline-none shadow-sm"
          />
          <button
            type="button"
            onClick={handleApplyCustomRtsp}
            disabled={isSwitching}
            className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
          >
            <Network className="w-3.5 h-3.5 text-teal-300" />
            <span>Connect RTSP</span>
          </button>
        </div>
      )}

      {selectedType === 'webcam' && (
        <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-white/10 flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <span className="font-medium">USB Device Index:</span>
          <select
            value={webcamIndex}
            onChange={(e) => {
              const idx = parseInt(e.target.value, 10);
              setWebcamIndex(idx);
              handleSelectPreset({
                id: 'usb-webcam',
                type: 'webcam',
                name: `USB Webcam #${idx}`,
                description: `Device Index ${idx}`,
                device_index: idx,
              });
            }}
            className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 text-slate-800 dark:text-slate-100 rounded-lg px-2.5 py-1 text-xs shadow-sm cursor-pointer"
          >
            <option value={0}>Index 0 (Default Camera)</option>
            <option value={1}>Index 1 (Secondary USB)</option>
            <option value={2}>Index 2 (Tertiary)</option>
          </select>
        </div>
      )}
    </div>
  );
};
