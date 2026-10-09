import React, { useState, useEffect } from 'react';
import {
  ROI,
  StreamSource,
  FrameTelemetry,
  Incident,
} from './types';
import { CameraFeed } from './components/CameraFeed';
import { ROIEditor } from './components/ROIEditor';
import { AlarmBanner } from './components/AlarmBanner';
import { RadioDispatchModal } from './components/RadioDispatchModal';
import { StreamSelector } from './components/StreamSelector';
import { IncidentHistory } from './components/IncidentHistory';
import { loadROI } from './services/api';
import { sirenSynthesizer } from './services/audioSiren';
import {
  Sliders,
  Radio,
  History,
  Activity,
  Cpu,
  Database,
  Waves,
  Clock,
  HardDrive,
  Volume2,
  VolumeX,
  Layers,
  ChevronDown,
  Gauge,
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

export const App: React.FC = () => {
  const [selectedCamera, setSelectedCamera] = useState<CameraOption>(CAMERAS[0]);
  const [currentRoi, setCurrentRoi] = useState<ROI>(CAMERAS[0].defaultRoi);
  const [isEditingRoi, setIsEditingRoi] = useState<boolean>(false);
  const [showRoiOverlay] = useState<boolean>(true);

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

  // Incident History Drawer
  const [isIncidentDrawerOpen, setIsIncidentDrawerOpen] = useState<boolean>(false);

  // Audio Siren Master State
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(false);

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
        }) + ' PST (UTC+8)'
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
    setTelemetry((prev) => ({
      ...prev,
      ...data,
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
    <div className="min-h-screen bg-eoc-darkest text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      {/* 1. TOP HEADER - LGU DRRMO Command Center */}
      <header className="bg-eoc-darker border-b border-eoc-border sticky top-0 z-40 backdrop-blur-md">
        <div className="max-w-[1720px] mx-auto px-4 py-2.5 sm:px-6 flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Logo & LGU Title */}
          <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-cyan-950/80 rounded-xl border border-cyan-500/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                <Waves className="w-5 h-5 text-cyan-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-extrabold tracking-wider text-white">
                    AGOS<span className="text-cyan-400">-OFFLINE</span>
                  </h1>
                  <span className="text-[10px] font-mono bg-cyan-950 text-cyan-300 border border-cyan-800 px-2 py-0.5 rounded font-semibold">
                    LOCAL AI CONSOLE
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono">
                  Philippine LGU DRRMO • Drainage Inflow & Flood Mitigation
                </p>
              </div>
            </div>

            {/* Offline Air-Gapped Pill */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-emerald-500/40 text-[11px] font-mono text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>100% AIR-GAPPED • ZERO CLOUD EGRESS</span>
            </div>
          </div>

          {/* Center: Camera Selector */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-center">
            <div className="relative w-full sm:w-auto min-w-[280px]">
              <select
                value={selectedCamera.id}
                onChange={(e) => {
                  const found = CAMERAS.find((c) => c.id === e.target.value);
                  if (found) setSelectedCamera(found);
                }}
                className="w-full bg-slate-900 border border-slate-700 text-slate-100 rounded-lg pl-3 pr-8 py-1.5 text-xs font-mono font-medium focus:outline-none focus:border-cyan-500 appearance-none cursor-pointer"
              >
                {CAMERAS.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {/* ROI Calibration Toggle */}
            <button
              type="button"
              onClick={() => setIsEditingRoi(!isEditingRoi)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono font-medium border transition-all ${
                isEditingRoi
                  ? 'bg-cyan-600 border-cyan-400 text-white shadow-lg shadow-cyan-950'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
              }`}
              title="Calibrate Grate Region of Interest (ROI)"
            >
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isEditingRoi ? 'Exit ROI' : 'Calibrate ROI'}</span>
            </button>
          </div>

          {/* Right Controls: Radio Dispatch, Siren Mute, PST Clock */}
          <div className="flex items-center gap-2.5 w-full md:w-auto justify-end">
            {/* Quick Radio Dispatch Trigger */}
            <button
              type="button"
              onClick={handleOpenRadioForCurrent}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400 shadow-md shadow-cyan-950/60 transition-transform active:scale-95"
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Radio Dispatch</span>
            </button>

            {/* Incident Drawer Button */}
            <button
              type="button"
              onClick={() => setIsIncidentDrawerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 transition-colors"
            >
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden sm:inline">Incidents</span>
            </button>

            {/* Audio Siren Master Mute */}
            <button
              type="button"
              onClick={handleToggleMute}
              className={`p-1.5 rounded-lg border transition-colors ${
                isSirenMuted
                  ? 'bg-slate-900 border-slate-700 text-slate-500'
                  : 'bg-slate-900 border-slate-700 text-cyan-400 hover:text-cyan-300'
              }`}
              title={isSirenMuted ? 'Unmute Emergency Siren' : 'Mute Emergency Siren'}
            >
              {isSirenMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            {/* Live Clock */}
            <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900/80 border border-slate-800 text-xs font-mono text-slate-300">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>{currentTime || '15:13:20 PST'}</span>
            </div>
          </div>
        </div>
      </header>

      {/* 2. ALARM BANNER - High-Visibility Alert with Web Audio Siren Synthesizer */}
      <AlarmBanner
        status={telemetry.status}
        occlusionRatio={telemetry.occlusion_ratio}
        cameraName={selectedCamera.name}
        onOpenRadioDispatch={handleOpenRadioForCurrent}
      />

      {/* 3. MAIN CONSOLE WORKSPACE */}
      <main className="flex-1 max-w-[1720px] w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT / CENTER VIEWPORT: CCTV Feed, ROI Editor, Stream Switcher (8 cols) */}
        <section className="lg:col-span-8 flex flex-col gap-4">
          {/* Camera Viewport Wrapper with Canvas Feed & ROI Editor Overlay */}
          <div className="relative rounded-2xl overflow-hidden border border-eoc-border bg-black shadow-2xl">
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

          {/* Stream Selector Controls */}
          <StreamSelector
            cameraId={selectedCamera.id}
            activeSource={activeStream}
            onSourceChange={(source) => setActiveStream(source)}
          />

          {/* Embedded Incidents Log Table */}
          <div className="mt-2">
            <IncidentHistory
              onSelectIncidentForRadio={handleOpenRadioForIncident}
              isOpenAsDrawer={false}
            />
          </div>
        </section>

        {/* RIGHT SIDEBAR: Grate Metrics, Occlusion Gauge, Telemetry, SOP (4 cols) */}
        <aside className="lg:col-span-4 flex flex-col gap-4">
          {/* A. Live Grate Occlusion Gauge Card */}
          <div className="bg-eoc-card/90 border border-eoc-border rounded-xl p-5 shadow-lg backdrop-blur-md">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Gauge className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-sm text-white">Grate Occlusion Ratio</h3>
              </div>
              <span
                className={`text-[11px] font-mono font-extrabold px-2 py-0.5 rounded border uppercase tracking-wider ${
                  isCritical
                    ? 'bg-rose-950 text-rose-300 border-rose-600 animate-pulse'
                    : isWarning
                    ? 'bg-amber-950 text-amber-300 border-amber-600'
                    : 'bg-emerald-950 text-emerald-300 border-emerald-600'
                }`}
              >
                {telemetry.status}
              </span>
            </div>

            {/* Occlusion Level Circular/Bar Gauge */}
            <div className="py-4">
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-4xl font-extrabold font-mono text-white tracking-tight">
                  {telemetry.occlusion_ratio.toFixed(1)}%
                </span>
                <span className="text-xs font-mono text-slate-400">
                  Threshold: ≥ 60.0% Critical
                </span>
              </div>

              {/* Progress Track */}
              <div className="w-full h-4 bg-slate-900 rounded-full overflow-hidden border border-slate-800 p-0.5 relative">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isCritical
                      ? 'bg-gradient-to-r from-amber-500 via-rose-500 to-rose-600 shadow-[0_0_15px_rgba(244,63,94,0.6)]'
                      : isWarning
                      ? 'bg-gradient-to-r from-emerald-500 to-amber-500'
                      : 'bg-gradient-to-r from-cyan-500 to-emerald-500'
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
                  className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10 shadow-[0_0_5px_red]"
                  style={{ left: '60%' }}
                  title="Critical Threshold (60%)"
                />
              </div>

              {/* Threshold Labels */}
              <div className="flex justify-between text-[10px] font-mono text-slate-500 mt-1.5">
                <span>0% CLEAR</span>
                <span className="text-amber-400/90 font-semibold">25% WARNING</span>
                <span className="text-rose-400 font-semibold">60% CRITICAL</span>
                <span>100%</span>
              </div>
            </div>

            {/* Hysteresis & Ponding Metrics */}
            <div className="grid grid-cols-2 gap-2 pt-3 border-t border-slate-800/80 text-xs font-mono">
              <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block text-[10px]">TEMPORAL SMOOTHING:</span>
                <span className="font-bold text-cyan-300">
                  {telemetry.hysteresis_ratio || '2-of-3 frames (Pass)'}
                </span>
              </div>
              <div className="bg-slate-900/70 p-2.5 rounded-lg border border-slate-800">
                <span className="text-slate-400 block text-[10px]">WATER BACK-UP DEPTH:</span>
                <span className="font-bold text-amber-300">
                  +{telemetry.pond_level_cm || 14.5} cm ponding
                </span>
              </div>
            </div>
          </div>

          {/* B. Detected Solid Waste Breakdown Card */}
          <div className="bg-eoc-card/90 border border-eoc-border rounded-xl p-5 shadow-lg backdrop-blur-md">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Layers className="w-5 h-5 text-cyan-400" />
                <h3 className="font-bold text-sm text-white">YOLOv8 Debris Breakdown</h3>
              </div>
              <span className="text-xs font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                {telemetry.detections.length} Classified Items
              </span>
            </div>

            <div className="space-y-2.5 mt-3">
              {telemetry.detections.map((det, idx) => (
                <div
                  key={idx}
                  className="p-2.5 rounded-lg bg-slate-900/70 border border-slate-800 flex items-center justify-between text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"></span>
                    <span className="font-semibold text-slate-200">{det.label}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-400">
                    <span>Conf:</span>
                    <span className="text-cyan-300 font-bold">
                      {(det.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Calibrated ROI Coordinates Display */}
            <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] font-mono text-slate-400 flex items-center justify-between">
              <span>Active Grate ROI:</span>
              <span className="text-cyan-400 font-bold">
                [{currentRoi.map((v) => v.toFixed(2)).join(', ')}]
              </span>
            </div>
          </div>

          {/* C. Quick Voice Radio Dispatch SOP Card */}
          <div className="bg-gradient-to-br from-eoc-card to-slate-900 border border-cyan-500/40 rounded-xl p-5 shadow-xl relative overflow-hidden">
            <div className="flex items-center gap-2 mb-2">
              <Radio className="w-5 h-5 text-cyan-400 animate-pulse" />
              <h3 className="font-bold text-sm text-white">VHF/UHF Voice Radio SOP</h3>
            </div>
            <p className="text-xs text-slate-300 mb-3 leading-relaxed">
              Dispatch immediate declogging team or barangay mobile patrol via two-way radio voice protocol.
            </p>

            <div className="bg-slate-950/90 p-3 rounded-lg border border-cyan-500/40 text-[11px] font-mono text-cyan-200 mb-3">
              "Command to Mobile Patrol: Drainage obstruction detected at {selectedCamera.name.split(':')[0]}..."
            </div>

            <button
              type="button"
              onClick={handleOpenRadioForCurrent}
              className="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold font-mono tracking-wider flex items-center justify-center gap-2 transition-transform active:scale-98 shadow-lg shadow-cyan-950/60"
            >
              <Radio className="w-4 h-4" />
              <span>LAUNCH RADIO DISPATCH TICKET</span>
            </button>
          </div>

          {/* D. Edge System Health & Telemetry */}
          <div className="bg-eoc-card/60 border border-eoc-border rounded-xl p-4 text-xs font-mono text-slate-400 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <span>VISION ENGINE:</span>
              </span>
              <span className="text-slate-200">YOLOv8 ONNX (CPU / iGPU)</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-emerald-400" />
                <span>INFERENCE LATENCY:</span>
              </span>
              <span className="text-emerald-300 font-bold">
                {telemetry.latency_ms > 0 ? `${telemetry.latency_ms} ms` : '22 ms'}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-amber-400" />
                <span>LOCAL DB ENGINE:</span>
              </span>
              <span className="text-slate-200">Embedded SQLite (agos.db)</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <HardDrive className="w-3.5 h-3.5 text-cyan-400" />
                <span>STORE-AND-FORWARD:</span>
              </span>
              <span className="text-slate-300">0 queued / Ready for sync</span>
            </div>
          </div>
        </aside>
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

      {/* Slide-out Drawer for Incident History */}
      {isIncidentDrawerOpen && (
        <IncidentHistory
          isOpenAsDrawer={true}
          onCloseDrawer={() => setIsIncidentDrawerOpen(false)}
          onSelectIncidentForRadio={(inc) => {
            setIsIncidentDrawerOpen(false);
            handleOpenRadioForIncident(inc);
          }}
        />
      )}
    </div>
  );
};

export default App;
