import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ROI,
  StreamSource,
  FrameTelemetry,
  Incident,
  OcclusionStatus,
  WeatherSnapshot,
} from './types';
import { CameraFeed } from './components/CameraFeed';
import { ROIEditor } from './components/ROIEditor';
import { AlarmBanner } from './components/AlarmBanner';
import { RadioDispatchModal } from './components/RadioDispatchModal';
import { StreamSelector } from './components/StreamSelector';
import { IncidentHistory } from './components/IncidentHistory';
import { Sidebar, NavTabId } from './components/Sidebar';
import { WeatherView } from './components/WeatherView';
import { DiagnosticsView } from './components/DiagnosticsView';
import { RespondersView } from './components/RespondersView';
import Container, { ContainerHeader } from './components/ui/Container';
import { loadROI, fetchWeather, fetchSyncStatus } from './services/api';
import { sirenSynthesizer } from './services/audioSiren';
import { useTheme } from './context/useTheme';
import { getWeatherIcon, getWeatherDescription, getRainTier } from './utils/weather';
import {
  Sliders,
  Radio,
  Clock,
  AlertTriangle,
  ChevronDown,
  Sun,
  Moon,
} from 'lucide-react';

interface CameraOption {
  id: string;
  name: string;
  location: string;
  defaultRoi: ROI;
}

const MapPinFilled = ({ className }: { className?: string }) => (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 13 8 13s8-7.75 8-13c0-4.42-3.58-8-8-8zm0 10.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
      fill="currentColor"
    />
    <circle cx="12" cy="10" r="2" fill="white" />
  </svg>
);

const CAMERAS: CameraOption[] = [
  {
    id: 'cam-01',
    name: 'CAM-01: Jiongco Creek Maysan',
    location: 'Jiongco Creek, Brgy. Maysan, Valenzuela City',
    defaultRoi: [0.0, 0.0, 1.0, 1.0],
  },
  {
    id: 'cam-02',
    name: 'CAM-02: Jet Malanday',
    location: 'Jet, Brgy. Malanday, Valenzuela City',
    defaultRoi: [0.15, 0.35, 0.85, 0.88],
  },
  {
    id: 'cam-03',
    name: 'CAM-03: Dela Cruz Gen T. De Leon',
    location: 'Dela Cruz, Brgy. Gen. T. de Leon, Valenzuela City',
    defaultRoi: [0.25, 0.45, 0.75, 0.92],
  },
];

export const App: React.FC = () => {
  const { isDark, toggleTheme } = useTheme();
  const [selectedCamera, setSelectedCamera] = useState<CameraOption>(CAMERAS[0]);
  const [currentRoi, setCurrentRoi] = useState<ROI>(CAMERAS[0].defaultRoi);
  const [isEditingRoi, setIsEditingRoi] = useState<boolean>(false);
  const [showRoiOverlay] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<NavTabId>('monitoring');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);

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
      { label: 'Debris', confidence: 0.88, box: [0.32, 0.52, 0.44, 0.62] },
      { label: 'Debris', confidence: 0.93, box: [0.48, 0.60, 0.56, 0.67] },
      { label: 'Debris', confidence: 0.79, box: [0.60, 0.65, 0.75, 0.79] },
    ],
    camera_id: CAMERAS[0].id,
    camera_name: CAMERAS[0].name,
    location: CAMERAS[0].location,
    hysteresis_ratio: '3/3 frames',
    trash_count: 3,
    store_and_forward_queue_size: 0,
  });

  // Radio Dispatch Modal
  const [isRadioModalOpen, setIsRadioModalOpen] = useState<boolean>(false);
  const [radioModalPayload, setRadioModalPayload] = useState<{
    incidentId?: string;
    cameraName: string;
    cameraId: string;
    location: string;
    occlusionRatio: number;
    status: string;
    debrisTypes?: string[];
    debrisCount?: number;
    initialRadioTicket?: string | null;
    targetGroupId?: string;
  }>({
    cameraName: CAMERAS[0].name,
    cameraId: CAMERAS[0].id,
    location: CAMERAS[0].location,
    occlusionRatio: 64.2,
    status: 'CRITICAL BLOCKED',
    debrisCount: 3,
    debrisTypes: [],
    targetGroupId: 'grp-drainage',
  });

  // Audio Siren Master State
  const [isSirenMuted, setIsSirenMuted] = useState<boolean>(false);

  // Weather & Cloud Sync State
  const [weather, setWeather] = useState<WeatherSnapshot>({
    is_online: false,
    rainfall_mm: 0.0,
    condition: 'Offline Mode',
    message: 'Offline (Weather unavailable)',
    temperature_c: null,
    humidity_pct: null,
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

  const refreshAux = async () => {
    const [w, s] = await Promise.all([fetchWeather(), fetchSyncStatus()]);
    setWeather(w);
    setSyncStatus(s);
  };

  useEffect(() => {
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

  const selectedCameraRef = useRef(selectedCamera);
  selectedCameraRef.current = selectedCamera;

  const handleTelemetryUpdate = useCallback((data: FrameTelemetry) => {
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
      camera_name: selectedCameraRef.current.name,
      location: selectedCameraRef.current.location,
    }));
  }, []);

  const handleOpenRadioForCurrent = () => {
    setRadioModalPayload({
      cameraName: selectedCamera.name,
      cameraId: selectedCamera.id,
      location: selectedCamera.location,
      occlusionRatio: telemetry.occlusion_ratio,
      status: telemetry.status,
      debrisCount: telemetry.trash_count ?? telemetry.detections.length,
      debrisTypes: [],
      targetGroupId: (selectedCamera as any).target_group_id,
    });
    setIsRadioModalOpen(true);
  };

  const handleOpenRadioForIncident = (inc: Incident) => {
    setRadioModalPayload({
      incidentId: inc.id,
      cameraName: inc.camera_name,
      cameraId: inc.camera_id,
      location: inc.location,
      occlusionRatio: inc.occlusion_ratio,
      status: inc.status,
      debrisCount: inc.debris_count,
      debrisTypes: inc.debris_types,
      initialRadioTicket: inc.radio_ticket,
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
  const isRainHazard = weather.rain_hazard?.active ?? false;
  const WeatherIcon = getWeatherIcon(weather.weather_code);
  const rainTier = getRainTier(weather.rainfall_mm);

  return (
    <div className="min-h-screen bg-background dark:bg-dark-gradient bg-fixed text-slate-900 dark:text-slate-200 flex flex-col font-sans transition-colors duration-300">
      {/* 1. COLLAPSIBLE DESKTOP SIDEBAR (matching agos-admin) */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        weather={weather}
        isSirenMuted={isSirenMuted}
        onToggleMute={handleToggleMute}
        syncStatus={syncStatus}
      />

      {/* 2. MAIN CONTENT AREA (offset by sidebar width) */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ${
          isSidebarCollapsed ? 'lg:ml-20' : 'lg:ml-56'
        }`}
      >
        {/* Streamlined Contextual Top Header */}
        <header className="sticky top-0 z-30 h-16 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border-b border-white/50 dark:border-white/10 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 transition-all duration-300">
          {/* Left: View Title & Context Controls */}
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="font-bold text-base sm:text-lg text-slate-900 dark:text-white tracking-tight truncate">
              {activeTab === 'monitoring'
                ? 'Live Drainage Monitoring'
                : activeTab === 'weather'
                ? 'Weather Intelligence'
                : activeTab === 'responders'
                ? 'Responders & Alerts Operations'
                : activeTab === 'incidents'
                ? 'Drainage Incident Log'
                : 'System Diagnostics'}
            </h1>

            {/* Location chip (agos-admin style) */}
            <div className="hidden md:flex items-center gap-2 border-r-2 border-gray-400 dark:border-slate-700 pr-4 mr-1">
              <div className="bg-red-100 dark:bg-red-900/30 p-1.5 rounded-lg">
                <MapPinFilled className="text-red-500" />
              </div>
              <span className="font-semibold text-sm md:text-base truncate">
                {weather.location ?? 'Valenzuela City'}
              </span>
            </div>

            {/* Contextual Camera Dropdown (shown on monitoring) */}
            {activeTab === 'monitoring' && (
              <div className="relative min-w-[240px] hidden sm:block">
                <select
                  value={selectedCamera.id}
                  onChange={(e) => {
                    const found = CAMERAS.find((c) => c.id === e.target.value);
                    if (found) setSelectedCamera(found);
                  }}
                  className="w-full bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 text-slate-800 dark:text-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-medium focus:outline-none focus:border-teal-500 appearance-none cursor-pointer shadow-xs"
                >
                  {CAMERAS.map((cam) => (
                    <option key={cam.id} value={cam.id}>
                      {cam.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Right: PST Clock, Theme Toggle & Quick Radio Trigger */}
          <div className="flex items-center gap-2.5 shrink-0">
            {isCritical && (
              <button
                type="button"
                onClick={handleOpenRadioForCurrent}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-semibold shadow-md shadow-rose-950/50 transition-all cursor-pointer animate-pulse"
              >
                <Radio className="w-3.5 h-3.5" />
                <span>Alert Responders</span>
              </button>
            )}

            {/* Backend Connection Status (agos-admin style) */}
            {weather.is_online ? (
              <div className="flex items-center gap-2 border-green-400 dark:border-emerald-800/50 border bg-green-100 dark:bg-emerald-900/20 py-1.5 px-2.5 md:py-2 md:px-3 rounded-md">
                <div className="bg-emerald-500 rounded-full w-3 h-3"></div>
                <p className="text-emerald-600 dark:text-emerald-400 text-xs md:text-sm font-semibold">Online</p>
              </div>
            ) : (
              <div className="flex items-center gap-2 border-amber-400 dark:border-amber-700/50 border bg-amber-100 dark:bg-amber-900/20 py-1.5 px-2.5 md:py-2 md:px-3 rounded-md">
                <div className="bg-amber-500 rounded-full w-3 h-3 pulse-circle"></div>
                <p className="text-amber-600 dark:text-amber-400 text-xs md:text-sm font-semibold">Offline Mode</p>
              </div>
            )}

            {/* Live Clock (agos-admin TimeDisplay style) */}
            <div className="hidden sm:flex items-center gap-2 text-sm border border-gray-300 dark:border-slate-700 px-3 py-2 rounded-lg bg-gray-50 dark:bg-slate-800/50">
              <div className="border-r-2 border-gray-400 dark:border-slate-700 pr-3 mr-3">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <p className="font-medium">{currentTime || 'PST'}</p>
                <p>
                  {new Date().toLocaleDateString('en-PH', {
                    timeZone: 'Asia/Manila',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {/* Top Bar Theme Toggle */}
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center justify-center p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-white/[0.05] dark:hover:bg-white/[0.1] border border-slate-200/80 dark:border-white/10 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer shadow-xs"
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-600" />}
            </button>
          </div>
        </header>

        {/* Floating Emergency Alarm Banner (when occluded) */}
        <AlarmBanner
          status={telemetry.status}
          occlusionRatio={telemetry.occlusion_ratio}
          cameraName={selectedCamera.name}
          onOpenRadioDispatch={handleOpenRadioForCurrent}
        />

        {/* Main View Router */}
        <main className="flex-1 p-3 md:p-4 lg:p-5">
          {/* LIVE MONITORING VIEW (Kept mounted so stream & telemetry continue across tabs) */}
          <div className={activeTab === 'monitoring' ? 'flex flex-col xl:flex-row w-full gap-2' : 'hidden'}>
            {/* LEFT VIEWPORT: Live feed (agos-admin VideoContainer look) */}
            <Container headerTitle="Live Feed" className="flex-1">
              {/* Camera identity + LIVE badge */}
              <div className="flex items-center justify-between font-semibold mb-3">
                <div className="bg-black/50 text-white px-2 py-1 md:px-3 md:py-1.5 rounded text-xs md:text-sm pointer-events-none truncate mr-2">
                  {`${selectedCamera.name} | ${selectedCamera.location}`}
                </div>
                {activeStream.type !== 'demo' ? (
                  <div className="flex items-center gap-2 border border-red-600 dark:border-red-800 bg-red-100 dark:bg-red-900/30 px-2.5 py-0.5 md:px-3.5 rounded shrink-0">
                    <span className="bg-red-600 rounded-full w-2.5 h-2.5 md:w-3 md:h-3 animate-pulse"></span>
                    <span className="text-red-600 dark:text-red-400 text-sm md:text-base">LIVE</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 border border-amber-400 dark:border-amber-700/50 bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 md:px-3.5 rounded shrink-0">
                    <span className="bg-amber-500 rounded-full w-2.5 h-2.5 md:w-3 md:h-3"></span>
                    <span className="text-amber-600 dark:text-amber-400 text-sm md:text-base">DEMO</span>
                  </div>
                )}
              </div>

              {/* Mobile Camera Dropdown */}
              <div className="flex sm:hidden items-center gap-2 bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl border border-white/50 dark:border-white/10 rounded-xl p-2.5 shadow-xl mb-3">
                <div className="relative flex-1">
                  <select
                    value={selectedCamera.id}
                    onChange={(e) => {
                      const found = CAMERAS.find((c) => c.id === e.target.value);
                      if (found) setSelectedCamera(found);
                    }}
                    className="w-full bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-white/10 text-slate-800 dark:text-slate-200 rounded-xl pl-3 pr-8 py-1.5 text-xs font-medium focus:outline-none appearance-none cursor-pointer"
                  >
                    {CAMERAS.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              </div>

              {/* Camera Canvas Viewport */}
              <div className="relative">
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

              {/* Sub-feed toolbar: Ingestion Source & ROI Button */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 mt-3">
                <div className="flex-1">
                  <StreamSelector
                    cameraId={selectedCamera.id}
                    activeSource={activeStream}
                    onSourceChange={(source) => setActiveStream(source)}
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIsEditingRoi(!isEditingRoi)}
                  className={`btn-custom text-xs font-medium border shrink-0 ${
                    isEditingRoi
                      ? 'bg-primary text-white dark:bg-blue-600 border-primary dark:border-blue-500 shadow-md font-semibold'
                      : 'bg-white/60 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.08] text-slate-700 dark:text-slate-300 border-white/50 dark:border-white/10 backdrop-blur-xl shadow-lg'
                  }`}
                  title="Adjust Camera Area"
                >
                  <Sliders className={`w-3.5 h-3.5 ${isEditingRoi ? 'text-white' : 'text-teal-500 dark:text-teal-400'}`} />
                  <span>{isEditingRoi ? 'Exit Camera Area' : 'Adjust Camera Area'}</span>
                </button>
              </div>
            </Container>

            {/* RIGHT COLUMN: Operative Metrics & Action */}
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 xl:w-2/6">
              {/* Drain Blockage Status Card (agos-admin BlockageStatusCard look) */}
              <Container>
                <div className="flex items-start justify-between gap-2">
                  <ContainerHeader title="Drain Blockage" />
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${
                      isCritical
                        ? 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800'
                        : isWarning
                        ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
                        : 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
                    }`}
                  >
                    <span className="uppercase tracking-wide">
                      {isCritical ? 'Blocked' : isWarning ? 'Potential' : 'Clear'}
                    </span>
                    <span className="opacity-70">{telemetry.occlusion_ratio.toFixed(1)}%</span>
                  </span>
                </div>

                {/* Status hero */}
                <div className="flex items-center gap-2 md:gap-3 my-1.5 md:my-2">
                  <span
                    className={`w-3.5 h-3.5 md:w-4 md:h-4 rounded-full ${
                      isCritical ? 'bg-blocked' : isWarning ? 'bg-partial' : 'bg-clear'
                    } ${isCritical ? 'pulse-circle' : ''}`}
                  ></span>
                  <span
                    className={`font-bold text-2xl md:text-3xl ${
                      isCritical ? 'text-blocked' : isWarning ? 'text-partial' : 'text-clear'
                    }`}
                  >
                    {String(telemetry.status || 'CLEAR')}
                  </span>
                </div>

                {/* Occlusion Progress Track (20% / 60% threshold markers) */}
                <div className="w-full h-3 bg-gray-200 dark:bg-white/10 rounded-full overflow-hidden p-0.5 relative shadow-inner">
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
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-amber-400/80 z-10"
                    style={{ left: '20%' }}
                    title="Warning Threshold (20%)"
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-rose-500 z-10"
                    style={{ left: '60%' }}
                    title="Heavy Blockage Threshold (60%)"
                  />
                </div>

                {/* Threshold Scale */}
                <div className="flex justify-between text-[11px] text-gray-500 dark:text-slate-400 mt-2">
                  <span>0% Clear</span>
                  <span className="text-amber-600 dark:text-amber-400 font-medium">20% Warning</span>
                  <span className="text-rose-600 dark:text-rose-400 font-medium">60% Heavy Blockage</span>
                  <span>100% Full</span>
                </div>

                {/* Secondary Indicators: Water Flow & Rain Hazard */}
                <div className="grid grid-cols-2 gap-2 pt-3 mt-3 border-t border-slate-200/60 dark:border-white/10 text-xs">
                  <div className="flex flex-col justify-center gap-0.5 rounded-xl p-2.5 md:p-3 border bg-white/40 dark:bg-white/[0.02] border-gray-200/50 dark:border-white/10 backdrop-blur-sm shadow-sm">
                    <p className="text-[0.7rem] md:text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Water Flow
                    </p>
                    <p
                      className={`text-sm md:text-base font-semibold ${
                        isCritical
                          ? 'text-rose-600 dark:text-rose-400'
                          : isWarning
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isCritical ? 'Clogged' : isWarning ? 'Slow Flow' : 'Normal Flowing'}
                    </p>
                  </div>
                  <div className="flex flex-col justify-center gap-0.5 rounded-xl p-2.5 md:p-3 border bg-white/40 dark:bg-white/[0.02] border-gray-200/50 dark:border-white/10 backdrop-blur-sm shadow-sm">
                    <p className="text-[0.7rem] md:text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                      Rain Hazard
                    </p>
                    <p
                      className={`text-sm md:text-base font-semibold ${
                        isRainHazard
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {isRainHazard
                        ? `Active (${weather.rain_hazard?.source === 'override' ? 'Override' : 'Auto'})`
                        : 'Normal'}
                    </p>
                  </div>
                </div>
              </Container>

              {/* Weather Condition Card (agos-admin WeatherConditionCard look) */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => setActiveTab('weather')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setActiveTab('weather');
                }}
                className="cursor-pointer"
                title="Open Weather Intelligence"
              >
                <Container className="h-full">
                  <div className="flex items-start justify-between gap-2">
                    <ContainerHeader title="Weather Condition" />
                    {isRainHazard && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800">
                        <AlertTriangle className="w-3 h-3" />
                        <span className="uppercase tracking-wide">Rain Hazard</span>
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2 items-center my-2">
                    <WeatherIcon
                      className={`w-8 h-8 md:w-10 md:h-10 shrink-0 ${
                        weather.is_online ? rainTier.colorClass : 'text-gray-400 dark:text-slate-500'
                      }`}
                    />
                    <div className="min-w-0">
                      <h2
                        className={`font-semibold text-xl md:text-2xl truncate ${
                          weather.is_online ? rainTier.colorClass : 'text-gray-400 dark:text-slate-500'
                        }`}
                      >
                        {weather.is_online ? weather.condition : 'Offline Mode'}
                      </h2>
                      <p className="text-xs md:text-sm text-gray-600 dark:text-slate-400 truncate">
                        {weather.is_online
                          ? getWeatherDescription(weather.weather_code)
                          : weather.message}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col justify-center gap-0.5 rounded-xl p-2.5 md:p-3 border bg-white/40 dark:bg-white/[0.02] border-gray-200/50 dark:border-white/10 backdrop-blur-sm shadow-sm">
                      <p className="text-[0.7rem] md:text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                        Rainfall
                      </p>
                      <p className="text-sm md:text-base font-semibold">
                        {weather.rainfall_mm.toFixed(1)} mm
                      </p>
                    </div>
                    <div className="flex flex-col justify-center gap-0.5 rounded-xl p-2.5 md:p-3 border bg-white/40 dark:bg-white/[0.02] border-gray-200/50 dark:border-white/10 backdrop-blur-sm shadow-sm">
                      <p className="text-[0.7rem] md:text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400">
                        Temperature
                      </p>
                      <p className="text-sm md:text-base font-semibold">
                        {weather.temperature_c !== null
                          ? `${Math.round(weather.temperature_c)}°C`
                          : '--°C'}
                      </p>
                    </div>
                  </div>
                </Container>
              </div>

              {/* Detected Trash Card */}
              <Container className="sm:col-span-2 xl:col-span-1">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <ContainerHeader title="Detected Trash" />
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold bg-gray-100 text-gray-600 border-gray-300 dark:bg-white/10 dark:text-slate-300 dark:border-white/10">
                    <span className="uppercase tracking-wide">
                      {telemetry.detections.length} Items
                    </span>
                  </span>
                </div>

                <div className="space-y-1.5 max-h-[175px] overflow-y-auto pr-1">
                  {telemetry.detections.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                      No blocking trash detected in camera area.
                    </p>
                  ) : (
                    [...telemetry.detections]
                      .sort((a, b) => b.confidence - a.confidence)
                      .map((det, idx) => (
                        <div
                          key={idx}
                          className="p-2 rounded-xl bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/10 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
                            <span className="font-medium text-slate-800 dark:text-slate-200 truncate capitalize">
                              {det.label || det.class_name || 'Debris'}
                            </span>
                          </div>
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[0.65rem] font-semibold font-mono bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800 shrink-0">
                            {(det.confidence * 100).toFixed(0)}%
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </Container>

              {/* Primary Action - Alert Responders Button */}
              <button
                type="button"
                onClick={handleOpenRadioForCurrent}
                className="btn-custom w-full bg-primary text-white hover:bg-primary/90 dark:bg-blue-600 dark:hover:bg-blue-500 font-semibold tracking-wide shadow-lg shadow-primary/20 sm:col-span-2 xl:col-span-1"
              >
                <Radio className="w-4 h-4" />
                <span>Alert Responders (Radio / SMS)</span>
              </button>
            </div>
          </div>

          {activeTab === 'weather' && (
            /* DEDICATED WEATHER INTELLIGENCE VIEW */
            <WeatherView weather={weather} onRefresh={refreshAux} />
          )}

          {activeTab === 'responders' && (
            /* DEDICATED RESPONDERS & ALERTS VIEW */
            <div className="w-full">
              <RespondersView />
            </div>
          )}

          {activeTab === 'incidents' && (
            /* DEDICATED INCIDENT HISTORY VIEW */
            <div className="w-full">
              <IncidentHistory
                onSelectIncidentForRadio={handleOpenRadioForIncident}
                isOpenAsDrawer={false}
              />
            </div>
          )}

          {activeTab === 'diagnostics' && (
            /* DEDICATED SYSTEM DIAGNOSTICS VIEW */
            <DiagnosticsView
              telemetry={telemetry}
              currentRoi={currentRoi}
              selectedCameraName={selectedCamera.name}
              syncStatus={syncStatus}
            />
          )}
        </main>
      </div>

      {/* 3. MODALS */}
      {/* VHF/UHF Voice Radio Dispatch Modal */}
      <RadioDispatchModal
        isOpen={isRadioModalOpen}
        onClose={() => setIsRadioModalOpen(false)}
        incidentId={radioModalPayload.incidentId}
        cameraName={radioModalPayload.cameraName}
        cameraId={radioModalPayload.cameraId}
        location={radioModalPayload.location}
        occlusionRatio={radioModalPayload.occlusionRatio}
        status={radioModalPayload.status}
        debrisTypes={radioModalPayload.debrisTypes}
        initialRadioTicket={radioModalPayload.initialRadioTicket}
        targetGroupId={radioModalPayload.targetGroupId}
        rainHazard={weather.rain_hazard?.active}
      />
    </div>
  );
};

export default App;
