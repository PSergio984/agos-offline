import React, { useState, useEffect } from 'react';
import {
  ROI,
  StreamSource,
  FrameTelemetry,
  Incident,
  OcclusionStatus,
} from './types';
import { CameraFeed } from './components/CameraFeed';
import { ROIEditor } from './components/ROIEditor';
import { AlarmBanner } from './components/AlarmBanner';
import { RadioDispatchModal } from './components/RadioDispatchModal';
import { StreamSelector } from './components/StreamSelector';
import { IncidentHistory } from './components/IncidentHistory';
import { loadROI, fetchWeather, fetchSyncStatus } from './services/api';
import { sirenSynthesizer } from './services/audioSiren';
import {
  Sliders,
  Radio,
  History,
  Activity,
  Cpu,
  Database,
  Clock,
  HardDrive,
  Volume2,
  VolumeX,
  Layers,
  ChevronDown,
  Gauge,
  CloudRain,
  CloudOff,
  Camera,
  Info,
  X,
  SlidersHorizontal,
} from 'lucide-react';

interface CameraOption {
  id: string;
  name: string;
  location: string;
  defaultRoi: ROI;
}

const CAMERAS: CameraOption[] = [
  {
    id: 'cam-01',
    name: 'CAM-01: Rizal Ave Culvert #4',
    location: 'Brgy. San Jose, Rizal Ave cor. Mabini St.',
    defaultRoi: [0.20, 0.40, 0.80, 0.90],
  },
  {
    id: 'cam-02',
    name: 'CAM-02: Taft Inflow Canal Gate 2',
    location: 'Brgy. Taft Central, Gate 2 Sluice',
    defaultRoi: [0.15, 0.35, 0.85, 0.88],
  },
  {
    id: 'cam-03',
    name: 'CAM-03: Quirino Curb Drain #11',
    location: 'Brgy. Poblacion, Quirino Ave Underpass',
    defaultRoi: [0.25, 0.45, 0.75, 0.92],
  },
];

type ActiveTab = 'monitoring' | 'incidents';

export const App: React.FC = () => {
  const [selectedCamera, setSelectedCamera] = useState<CameraOption>(CAMERAS[0]);
  const [currentRoi, setCurrentRoi] = useState<ROI>(CAMERAS[0].defaultRoi);
  const [isEditingRoi, setIsEditingRoi] = useState<boolean>(false);
  const [showRoiOverlay] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<ActiveTab>('monitoring');
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);

  // Active Stream Source
  const [activeStream, setActiveStream] = useState<StreamSource>({
    id: 'demo-mp4',
    type: 'demo',
    name: 'Demo Video (MP4)',
    description: 'sample_media/drainage_demo.mp4 (Offline Culvert Loop)',
    url: 'sample_media/drainage_demo.mp4',
  });

  // Telemetry state from video feed
  const [telemetry, setTelemetry] = useState<FrameTelemetry>({
    timestamp: Date.now(),
    fps: 10,
    latency_ms: 22,
    occlusion_ratio: 64.2,
    status: 'CRITICAL BLOCKED',
    roi: CAMERAS[0].defaultRoi,
    detections: [
      { label: 'Plastic Sack', confidence: 0.88, box: [0.32, 0.52, 0.44, 0.62] },
      { label: 'Plastic Bottle', confidence: 0.93, box: [0.48, 0.60, 0.56, 0.67] },
      { label: 'Vegetation Cluster', confidence: 0.79, box: [0.60, 0.65, 0.75, 0.79] },
    ],
    camera_id: CAMERAS[0].id,
    camera_name: CAMERAS[0].name,
    location: CAMERAS[0].location,
    hysteresis_ratio: '3/3 frames',
    trash_count: 3,
    pond_level_cm: 14.5,
    store_and_forward_queue_size: 0,
  });

  // Radio Dispatch Modal
  const [isRadioModalOpen, setIsRadioModalOpen] = useState<boolean>(false);
  const [radioModalPayload, setRadioModalPayload] = useState<{
    cameraName: string;
    cameraId: string;
    location: string;
    occlusionRatio: number;
    status: string;
    debrisTypes: string[];
  }>({
    cameraName: CAMERAS[0].name,
    cameraId: CAMERAS[0].id,
    location: CAMERAS[0].location,
    occlusionRatio: 64.2,
    status: 'CRITICAL BLOCKED',
    debrisTypes: ['Plastic Sacks', 'Vegetation Cluster', 'Plastic Bottles'],
  });

  // Audio Siren Master State
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(false);

  // Weather & Cloud Sync State
  const [weather, setWeather] = useState<{
    is_online: boolean;
    rainfall_mm: number;
    condition: string;
    message: string;
    temperature_c: number | null;
  }>({
    is_online: false,
    rainfall_mm: 0.0,
    condition: 'Offline Mode',
    message: 'Offline (Weather unavailable)',
    temperature_c: null,
  });

  const [syncStatus, setSyncStatus] = useState<{
    is_online: boolean;
    status: string;
    status_label: string;
    pending_count: number;
    synced_count: number;
  }>({
    is_online: false,
    status: 'LOCAL_OFFLINE',
    status_label: 'Local Offline Mode',
    pending_count: 0,
    synced_count: 0,
  });

  useEffect(() => {
    const refreshAux = async () => {
      const [w, s] = await Promise.all([fetchWeather(), fetchSyncStatus()]);
      setWeather(w);
      setSyncStatus(s);
    };
    refreshAux();
    const interval = setInterval(refreshAux, 20000);
    return () => clearInterval(interval);
  }, []);

  // System Clock (Philippine Standard Time PST)
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-PH', {
          timeZone: 'Asia/Manila',
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }) + ' PST'
      );
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load ROI for camera on mount or switch
  useEffect(() => {
    async function initRoi() {
      const saved = await loadROI(selectedCamera.id);
      if (saved) {
        setCurrentRoi(saved);
      } else {
        setCurrentRoi(selectedCamera.defaultRoi);
      }
    }
    initRoi();
  }, [selectedCamera]);

  const handleTelemetryUpdate = (data: FrameTelemetry) => {
    const rawStatus = (data as any).status;
    const safeStatus: OcclusionStatus =
      typeof rawStatus === 'string'
        ? (rawStatus as OcclusionStatus)
        : (data.status && typeof (data.status as any).status === 'string'
            ? ((data.status as any).status as OcclusionStatus)
            : 'CLEAR');

    setTelemetry((prev) => ({
      ...prev,
      ...data,
      status: safeStatus,
      camera_name: selectedCamera.name,
      location: selectedCamera.location,
    }));
  };

  const handleOpenRadioForCurrent = () => {
    setRadioModalPayload({
      cameraName: selectedCamera.name,
      cameraId: selectedCamera.id,
      location: selectedCamera.location,
      occlusionRatio: telemetry.occlusion_ratio,
      status: telemetry.status,
      debrisTypes: telemetry.detections.map((d) => d.label),
    });
    setIsRadioModalOpen(true);
  };

  const handleOpenRadioForIncident = (inc: Incident) => {
    setRadioModalPayload({
      cameraName: inc.camera_name,
      cameraId: inc.camera_id,
      location: inc.location,
      occlusionRatio: inc.occlusion_ratio,
      status: inc.status,
      debrisTypes: inc.debris_types,
    });
    setIsRadioModalOpen(true);
  };

  const handleToggleMute = () => {
    const next = !isSirenMuted;
    setIsSirenMuted(next);
    sirenSynthesizer.setMuted(next);
  };

  const isCritical = telemetry.status === 'CRITICAL' || telemetry.status === 'CRITICAL BLOCKED';
  const isWarning = telemetry.status === 'WARNING';

  return (
    <div className="min-h-screen bg-[#050B14] text-slate-100 flex flex-col font-sans selection:bg-teal-500 selection:text-white">
      {/* 1. TOP NAVBAR - Minimalist AGOS Header */}
      <header className="sticky top-0 z-40 backdrop-blur-md bg-[#050B14]/85 border-b border-slate-800/80 transition-all">
        <div className="max-w-[1720px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center gap-4">
            {/* Brand Logo & Title */}
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 bg-primary/20 rounded-xl border border-teal-500/30 overflow-hidden shadow-sm">
                <img
                  src="/agos.svg"
                  alt="AGOS Logo"
                  className="w-6 h-6 object-contain"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-xl tracking-tight text-white">
                  AGOS
                </span>
                <span className="text-[11px] font-medium text-teal-300 bg-teal-500/10 border border-teal-500/20 px-2 py-0.5 rounded-full">
                  Offline Console
                </span>
              </div>
            </div>

            {/* Center: Navigation Tabs */}
            <div className="flex items-center bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
              <button
                type="button"
                onClick={() => setActiveTab('monitoring')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'monitoring'
                    ? 'bg-primary text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Live Monitoring</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveTab('incidents')}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'incidents'
                    ? 'bg-primary text-white shadow-sm font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Incident Log</span>
              </button>
            </div>

            {/* Right: Status Indicators & Diagnostics */}
            <div className="flex items-center gap-3">
              {/* Connectivity Pill */}
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 rounded-full bg-slate-950/70 border border-slate-800 text-xs">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-slate-300 font-medium">Local Offline</span>
              </div>

              {/* Weather Status */}
              <div className="hidden lg:flex items-center gap-1.5 text-xs text-slate-400 bg-slate-950/50 px-3 py-1 rounded-full border border-slate-800/80">
                {weather.is_online ? (
                  <>
                    <CloudRain className="w-3.5 h-3.5 text-teal-400" />
                    <span>{weather.message}</span>
                  </>
                ) : (
                  <>
                    <CloudOff className="w-3.5 h-3.5 text-slate-500" />
                    <span>Local Weather Cache</span>
                  </>
                )}
              </div>

              {/* Siren Audio Toggle */}
              <button
                type="button"
                onClick={handleToggleMute}
                className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                  isSirenMuted
                    ? 'bg-slate-900/80 border-slate-800 text-slate-500 hover:text-slate-300'
                    : 'bg-primary/20 border-teal-500/30 text-teal-400 hover:bg-primary/30'
                }`}
                title={isSirenMuted ? 'Unmute Emergency Siren' : 'Mute Emergency Siren'}
              >
                {isSirenMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              {/* System Diagnostics Drawer Trigger */}
              <button
                type="button"
                onClick={() => setIsDiagnosticsOpen(true)}
                className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="System Diagnostics & Telemetry"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>

              {/* PST Clock */}
              <div className="hidden xl:flex items-center gap-1.5 text-xs font-mono text-slate-400 bg-slate-950/60 px-2.5 py-1 rounded-lg border border-slate-800/80">
                <Clock className="w-3.5 h-3.5 text-teal-400" />
                <span>{currentTime || 'PST'}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* 2. FLOATING ALARM BANNER (When Occluded) */}
      <AlarmBanner
        status={telemetry.status}
        occlusionRatio={telemetry.occlusion_ratio}
        cameraName={selectedCamera.name}
        onOpenRadioDispatch={handleOpenRadioForCurrent}
      />

      {/* 3. MAIN WORKSPACE */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 sm:p-6 lg:p-8">
        {activeTab === 'monitoring' ? (
          /* LIVE MONITORING VIEW */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT VIEWPORT: Camera feed + Contextual Controls (8 cols) */}
            <section className="lg:col-span-8 flex flex-col gap-4">
              {/* Contextual Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-3 backdrop-blur-md shadow-sm">
                {/* Camera Selector Dropdown */}
                <div className="relative min-w-[260px] flex-1 sm:flex-initial">
                  <select
                    value={selectedCamera.id}
                    onChange={(e) => {
                      const found = CAMERAS.find((c) => c.id === e.target.value);
                      if (found) setSelectedCamera(found);
                    }}
                    className="w-full bg-slate-950/80 border border-slate-700/70 text-slate-100 rounded-xl pl-3.5 pr-9 py-2 text-xs font-medium focus:outline-none focus:border-teal-500 appearance-none cursor-pointer"
                  >
                    {CAMERAS.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>

                {/* Calibrate Grate ROI Button */}
                <button
                  type="button"
                  onClick={() => setIsEditingRoi(!isEditingRoi)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium border transition-all cursor-pointer ${
                    isEditingRoi
                      ? 'bg-teal-500 text-slate-950 border-teal-400 shadow-md font-semibold'
                      : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border-slate-700/60'
                  }`}
                  title="Calibrate Grate Region of Interest (ROI)"
                >
                  <Sliders className={`w-3.5 h-3.5 ${isEditingRoi ? 'text-slate-950' : 'text-teal-400'}`} />
                  <span>{isEditingRoi ? 'Exit ROI Editor' : 'Calibrate Grate ROI'}</span>
                </button>
              </div>

              {/* Camera Canvas Viewport */}
              <div className="relative rounded-2xl overflow-hidden border border-slate-800/80 bg-black shadow-2xl">
                <CameraFeed
                  roi={currentRoi}
                  showROIOverlay={showRoiOverlay}
                  isROIEditing={isEditingRoi}
                  onTelemetryUpdate={handleTelemetryUpdate}
                  cameraId={selectedCamera.id}
                  cameraName={selectedCamera.name}
                />

                {/* Interactive ROI Editor Overlay */}
                <ROIEditor
                  isActive={isEditingRoi}
                  initialROI={currentRoi}
                  cameraId={selectedCamera.id}
                  onSave={(newRoi) => {
                    setCurrentRoi(newRoi);
                  }}
                  onClose={() => setIsEditingRoi(false)}
                />
              </div>

              {/* Ingestion Source Switcher Bar */}
              <StreamSelector
                cameraId={selectedCamera.id}
                activeSource={activeStream}
                onSourceChange={(source) => setActiveStream(source)}
              />
            </section>

            {/* RIGHT SIDEBAR: Operative Metrics & Action (4 cols) */}
            <aside className="lg:col-span-4 flex flex-col gap-5">
              {/* Card 1: Grate Occlusion Gauge Card */}
              <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg backdrop-blur-md">
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-2.5">
                    <Gauge className="w-5 h-5 text-teal-400" />
                    <h3 className="font-bold text-sm text-white">Grate Occlusion</h3>
                  </div>
                  <span
                    className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full border uppercase tracking-wider ${
                      isCritical
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : isWarning
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    }`}
                  >
                    {String(telemetry.status || 'CLEAR')}
                  </span>
                </div>

                {/* Occlusion Level Bar & Number */}
                <div className="py-5">
                  <div className="flex items-baseline justify-between mb-2.5">
                    <span className="text-4xl font-extrabold text-white tracking-tight">
                      {telemetry.occlusion_ratio.toFixed(1)}%
                    </span>
                    <span className="text-xs text-slate-400">
                      Critical Threshold: ≥ 60.0%
                    </span>
                  </div>

                  {/* Progress Track */}
                  <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden border border-slate-800 p-0.5 relative">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        isCritical
                          ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                          : isWarning
                          ? 'bg-gradient-to-r from-emerald-500 to-amber-500'
                          : 'bg-gradient-to-r from-teal-500 to-emerald-500'
                      }`}
                      style={{ width: `${Math.min(100, Math.max(0, telemetry.occlusion_ratio))}%` }}
                    />
                    {/* 25% Warning Marker */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-amber-400/80 z-10"
                      style={{ left: '25%' }}
                      title="Warning Threshold (25%)"
                    />
                    {/* 60% Critical Marker */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10"
                      style={{ left: '60%' }}
                      title="Critical Threshold (60%)"
                    />
                  </div>

                  {/* Threshold Scale */}
                  <div className="flex justify-between text-[11px] text-slate-400 mt-2">
                    <span>0% Clear</span>
                    <span className="text-amber-400 font-medium">25% Warning</span>
                    <span className="text-rose-400 font-medium">60% Critical</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Secondary Indicators: Temporal Smoothing & Water Level */}
                <div className="grid grid-cols-2 gap-3 pt-4 border-t border-slate-800/80 text-xs">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px] mb-1">Temporal Smoothing:</span>
                    <span className="font-semibold text-teal-300">
                      {telemetry.hysteresis_ratio || '2-of-3 frames (Pass)'}
                    </span>
                  </div>
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/80">
                    <span className="text-slate-400 block text-[11px] mb-1">Ponding Backup:</span>
                    <span className="font-semibold text-amber-300">
                      +{telemetry.pond_level_cm || 14.5} cm depth
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Debris Breakdown Card */}
              <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-5 shadow-lg backdrop-blur-md">
                <div className="flex items-center justify-between pb-3.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-2.5">
                    <Layers className="w-5 h-5 text-teal-400" />
                    <h3 className="font-bold text-sm text-white">Classified Debris</h3>
                  </div>
                  <span className="text-xs text-teal-300 bg-teal-500/10 px-2.5 py-0.5 rounded-full border border-teal-500/20">
                    {telemetry.detections.length} Items Detected
                  </span>
                </div>

                <div className="space-y-2 mt-3.5">
                  {telemetry.detections.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">No occluding debris detected in active ROI.</p>
                  ) : (
                    telemetry.detections.map((det, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-xl bg-slate-950/50 border border-slate-800/70 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-rose-400" />
                          <span className="font-medium text-slate-200">{det.label}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <span>Conf:</span>
                          <span className="text-teal-300 font-semibold font-mono">
                            {(det.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Card 3: Primary Action - Voice Radio Dispatch Button */}
              <button
                type="button"
                onClick={handleOpenRadioForCurrent}
                className="w-full py-3.5 px-4 bg-primary hover:bg-primary/90 text-white rounded-2xl text-xs sm:text-sm font-semibold tracking-wide flex items-center justify-center gap-2.5 shadow-lg shadow-primary/20 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
              >
                <Radio className="w-4 h-4 text-teal-300" />
                <span>Launch Voice Radio Dispatch Ticket</span>
              </button>
            </aside>
          </div>
        ) : (
          /* INCIDENTS TAB VIEW - Full Width Clean History */
          <div className="w-full">
            <IncidentHistory
              onSelectIncidentForRadio={handleOpenRadioForIncident}
              isOpenAsDrawer={false}
            />
          </div>
        )}
      </main>

      {/* 4. MODALS & DRAWERS */}
      {/* VHF/UHF Voice Radio Dispatch Modal */}
      <RadioDispatchModal
        isOpen={isRadioModalOpen}
        onClose={() => setIsRadioModalOpen(false)}
        cameraName={radioModalPayload.cameraName}
        cameraId={radioModalPayload.cameraId}
        location={radioModalPayload.location}
        occlusionRatio={radioModalPayload.occlusionRatio}
        status={radioModalPayload.status}
        debrisTypes={radioModalPayload.debrisTypes}
      />

      {/* System Diagnostics Slide-out Drawer */}
      {isDiagnosticsOpen && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md h-full bg-[#0B1526] border-l border-slate-800 shadow-2xl flex flex-col font-sans">
            {/* Drawer Header */}
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-primary/20 text-teal-400 rounded-xl border border-teal-500/20">
                  <SlidersHorizontal className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">System Diagnostics</h3>
                  <p className="text-xs text-slate-400">Edge telemetry & runtime specifications</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDiagnosticsOpen(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Diagnostics Items */}
            <div className="p-5 space-y-4 flex-1 overflow-y-auto text-xs text-slate-300">
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-400">
                    <Cpu className="w-4 h-4 text-teal-400" />
                    <span>Vision Inference:</span>
                  </span>
                  <span className="text-white font-medium">YOLOv8 ONNX Runtime</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-400">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span>Inference Latency:</span>
                  </span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {telemetry.latency_ms > 0 ? `${telemetry.latency_ms} ms` : '22 ms'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-400">
                    <Database className="w-4 h-4 text-amber-400" />
                    <span>Local Database:</span>
                  </span>
                  <span className="text-white font-medium">SQLite (agos.db)</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-slate-400">
                    <HardDrive className="w-4 h-4 text-teal-400" />
                    <span>Cloud Sync Queue:</span>
                  </span>
                  <span className="text-slate-300 font-mono">
                    {syncStatus.pending_count} pending / Local Store-and-Forward
                  </span>
                </div>
              </div>

              {/* Active Grate ROI Coordinates */}
              <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80">
                <span className="text-slate-400 block mb-1">Active Grate Calibration ROI:</span>
                <span className="text-teal-300 font-mono font-semibold">
                  [{currentRoi.map((v) => v.toFixed(2)).join(', ')}]
                </span>
              </div>

              {/* Tactical Two-Way Radio SOP Card */}
              <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 space-y-2">
                <div className="flex items-center gap-2 text-teal-300 font-semibold">
                  <Radio className="w-4 h-4 text-teal-400" />
                  <span>VHF/UHF Voice Radio SOP</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  In case of critical drainage obstruction, transmit the pre-formatted voice ticket directly to barangay or city mobile patrols over municipal tactical VHF/UHF repeaters.
                </p>
                <div className="p-3 bg-slate-900/90 rounded-lg text-slate-300 font-mono text-[11px] border border-slate-800">
                  "Command to Mobile Patrol: Drainage obstruction detected at {selectedCamera.name.split(':')[0]}..."
                </div>
              </div>

              {/* Offline Assurance Notice */}
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-300 text-[11px] leading-relaxed flex items-start gap-2">
                <Info className="w-4 h-4 flex-shrink-0 mt-0.5 text-emerald-400" />
                <span>
                  AGOS-Offline operates 100% on-premises without internet access. Camera streams, YOLOv8 detections, alarms, and incident logging require zero external network connection.
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-950/80 border-t border-slate-800 flex justify-end">
              <button
                type="button"
                onClick={() => setIsDiagnosticsOpen(false)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
