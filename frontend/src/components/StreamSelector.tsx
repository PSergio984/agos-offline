import React, { useState } from 'react';
import { StreamSource, StreamSourceType } from '../types';
import { switchStream } from '../services/api';
import { Video, Camera, Network, Play, Check } from 'lucide-react';

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
    <div className="bg-eoc-dark/80 border border-eoc-border rounded-xl p-4 shadow-lg backdrop-blur-md">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
        <div>
          <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <Video className="w-4 h-4 text-cyan-400" />
            <span>Video Ingestion Source</span>
          </h4>
          <p className="text-xs text-slate-400">
            Switch between offline MP4 evaluation loops, local USB webcams, or municipal RTSP IP cameras
          </p>
        </div>

        {statusMessage && (
          <div className="flex items-center gap-1.5 text-xs text-cyan-300 font-mono bg-cyan-950/80 px-2.5 py-1 rounded border border-cyan-800">
            <Check className="w-3.5 h-3.5 text-cyan-400" />
            <span>{statusMessage}</span>
          </div>
        )}
      </div>

      {/* Preset Source Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
        {PRESET_SOURCES.map((source) => {
          const isActive = activeSource.type === source.type && (source.type !== 'rtsp' || activeSource.id === source.id);
          const Icon = source.type === 'demo' ? Play : source.type === 'webcam' ? Camera : Network;

          return (
            <button
              key={source.id}
              type="button"
              onClick={() => handleSelectPreset(source)}
              disabled={isSwitching}
              className={`p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between group ${
                isActive
                  ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-950/50'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900/90'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div
                    className={`p-2 rounded-lg ${
                      isActive ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-400 group-hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">{source.name}</span>
                    <span className="text-[10px] text-slate-500 font-mono uppercase">
                      {source.type}
                    </span>
                  </div>
                </div>

                {isActive && (
                  <span className="flex items-center gap-1 text-[10px] font-mono bg-cyan-900 text-cyan-300 px-2 py-0.5 rounded-full border border-cyan-500">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></span>
                    ACTIVE
                  </span>
                )}
              </div>

              <div className="mt-2 text-[11px] text-slate-400 truncate font-mono">
                {source.description}
              </div>
            </button>
          );
        })}
      </div>

      {/* Additional Controls for Custom RTSP or Webcam selection */}
      <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-center gap-3">
        {selectedType === 'rtsp' && (
          <div className="w-full flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={customRtspUrl}
                onChange={(e) => setCustomRtspUrl(e.target.value)}
                placeholder="rtsp://admin:password@192.168.1.100:554/stream1"
                className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handleApplyCustomRtsp}
              disabled={isSwitching}
              className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-sm"
            >
              <Network className="w-3.5 h-3.5" />
              <span>Connect RTSP</span>
            </button>
          </div>
        )}

        {selectedType === 'webcam' && (
          <div className="w-full flex items-center gap-3 text-xs text-slate-400 font-mono">
            <span>USB Video Device Index:</span>
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
              className="bg-slate-950 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs font-mono"
            >
              <option value={0}>Index 0 (Default Camera)</option>
              <option value={1}>Index 1 (Secondary USB)</option>
              <option value={2}>Index 2 (Tertiary)</option>
            </select>
          </div>
        )}

        {selectedType === 'demo' && (
          <div className="w-full text-[11px] text-slate-400 flex items-center gap-1.5 font-mono">
            <span className="text-cyan-400 font-bold">MODE:</span>
            <span>Local demo loop active (`sample_media/drainage_demo.mp4`). Continuous playback with simulated or actual OpenCV loop.</span>
          </div>
        )}
      </div>
    </div>
  );
};
