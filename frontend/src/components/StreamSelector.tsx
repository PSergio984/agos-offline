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
    id: 'demo-mp4',
    type: 'demo',
    name: 'Demo Video (MP4)',
    description: 'sample_media/drainage_demo.mp4 (Offline Culvert Loop)',
    url: 'sample_media/drainage_demo.mp4',
  },
  {
    id: 'usb-webcam',
    type: 'webcam',
    name: 'USB Webcam (Direct)',
    description: 'Hardware V4L2 / DirectShow Device Index #0',
    device_index: 0,
  },
  {
    id: 'rtsp-cctv',
    type: 'rtsp',
    name: 'Municipal CCTV RTSP',
    description: 'Live H.264/H.265 RTSP Stream (Local Intranet)',
    url: 'rtsp://admin:pass@192.168.1.120:554/live/ch0',
  },
];

export const StreamSelector: React.FC<StreamSelectorProps> = ({
  cameraId,
  activeSource,
  onSourceChange,
}) => {
  const [selectedType, setSelectedType] = useState<StreamSourceType>(activeSource.type);
  const [customRtspUrl, setCustomRtspUrl] = useState<string>(
    activeSource.type === 'rtsp' && activeSource.url ? activeSource.url : 'rtsp://admin:drrmo2026@192.168.1.50:554/h264'
  );
  const [webcamIndex, setWebcamIndex] = useState<number>(activeSource.device_index ?? 0);
  const [isSwitching, setIsSwitching] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const handleSelectPreset = async (source: StreamSource) => {
    setIsSwitching(true);
    setStatusMessage(null);
    setSelectedType(source.type);

    try {
      await switchStream(cameraId, source);
      onSourceChange(source);
      setStatusMessage(`Switched ingestion to ${source.name}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage(`Failed to switch to ${source.name}`);
    } finally {
      setIsSwitching(false);
    }
  };

  const handleApplyCustomRtsp = async () => {
    if (!customRtspUrl.trim()) return;
    setIsSwitching(true);
    const customSource: StreamSource = {
      id: 'custom-rtsp',
      type: 'rtsp',
      name: 'Custom RTSP Stream',
      description: customRtspUrl,
      url: customRtspUrl,
    };

    try {
      await switchStream(cameraId, customSource);
      onSourceChange(customSource);
      setStatusMessage(`Active: ${customRtspUrl}`);
      setTimeout(() => setStatusMessage(null), 3000);
    } catch {
      setStatusMessage('Failed connecting to custom RTSP stream');
    } finally {
      setIsSwitching(false);
    }
  };

  return (
    <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-3 sm:p-4 shadow-md backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Source Switcher Segmented Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-950/60 p-1 rounded-xl border border-slate-800/70 overflow-x-auto">
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
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-teal-300' : 'text-slate-400'}`} />
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
          <div className="flex items-center gap-1.5 text-xs text-teal-300 bg-teal-500/10 px-3 py-1 rounded-full border border-teal-500/20">
            <Check className="w-3.5 h-3.5 text-teal-400" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Contextual Configuration Row for RTSP & Webcam */}
      {selectedType === 'rtsp' && (
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            value={customRtspUrl}
            onChange={(e) => setCustomRtspUrl(e.target.value)}
            placeholder="rtsp://admin:password@192.168.1.100:554/stream1"
            className="flex-1 bg-slate-950/80 border border-slate-700/60 text-slate-200 rounded-xl px-3 py-1.5 text-xs focus:border-teal-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleApplyCustomRtsp}
            disabled={isSwitching}
            className="px-4 py-1.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Network className="w-3.5 h-3.5 text-teal-300" />
            <span>Connect RTSP</span>
          </button>
        </div>
      )}

      {selectedType === 'webcam' && (
        <div className="mt-3 pt-3 border-t border-slate-800/60 flex items-center gap-3 text-xs text-slate-400">
          <span>USB Device Index:</span>
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
            className="bg-slate-950/80 border border-slate-700/60 text-slate-200 rounded-lg px-2.5 py-1 text-xs"
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
