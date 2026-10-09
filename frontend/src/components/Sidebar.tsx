import {
  MonitorDot,
  CloudSunRain,
  FileCheck,
  Cpu,
  PanelLeftClose,
  PanelLeftOpen,
  Volume2,
  VolumeX,
  AlertTriangle,
  Users,
} from 'lucide-react';
import { getWeatherIcon } from '../utils/weather';
import { WeatherSnapshot } from '../types';

export type NavTabId = 'monitoring' | 'weather' | 'responders' | 'incidents' | 'diagnostics';

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  weather: WeatherSnapshot;
  isSirenMuted: boolean;
  onToggleMute: () => void;
  syncStatus: {
    is_online: boolean;
    status: string;
    status_label: string;
    pending_count: number;
    synced_count: number;
  };
}

const NAV_ITEMS: { id: NavTabId; name: string; icon: React.ComponentType<{ className?: string }> }[] = [
  {
    id: 'monitoring',
    name: 'Live Monitoring',
    icon: MonitorDot,
  },
  {
    id: 'weather',
    name: 'Weather',
    icon: CloudSunRain,
  },
  {
    id: 'responders',
    name: 'Responders & Alerts',
    icon: Users,
  },
  {
    id: 'incidents',
    name: 'Incident Log',
    icon: FileCheck,
  },
  {
    id: 'diagnostics',
    name: 'Diagnostics',
    icon: Cpu,
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  isCollapsed,
  onToggle,
  activeTab,
  onSelectTab,
  weather,
  isSirenMuted,
  onToggleMute,
}) => {
  const WeatherMiniIcon = getWeatherIcon(weather.weather_code);
  const isRainHazard = weather.rain_hazard?.active ?? false;

  return (
    <aside
      className={`fixed top-0 bottom-0 left-0 z-40 flex flex-col border-r border-slate-200 dark:border-slate-700/50 bg-white dark:bg-slate-800/30 dark:backdrop-blur-xl transition-all duration-200 select-none overflow-hidden ${
        isCollapsed ? 'w-20' : 'w-56'
      }`}
    >
      {/* 1. Header / Brand & Toggle */}
      <div className="w-full px-5 flex items-center justify-between py-2 mt-1">
        {!isCollapsed && (
          <div className="rounded-md" title="AGOS Offline">
            <img src="/agos.svg" alt="AGOS" className="w-7" />
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          className="flex items-center justify-center rounded-lg p-2 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors text-gray-500 dark:text-slate-400 cursor-pointer"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="w-5 h-5" />
          ) : (
            <PanelLeftClose className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* 2. Navigation Items */}
      <nav className="flex-1 px-5 py-4 space-y-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isWeatherTab = item.id === 'weather';

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center rounded-xl transition-colors cursor-pointer ${
                isCollapsed ? 'justify-center p-3' : 'gap-2 py-3.5 px-3'
              } ${
                isActive
                  ? isCollapsed
                    ? 'bg-primary/10 dark:bg-blue-500/10 text-primary dark:text-blue-400'
                    : 'border-l-[4px] bg-primary/5 dark:bg-blue-500/10 border-primary dark:border-blue-500 text-primary dark:text-blue-400 font-semibold'
                  : 'text-neutral dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800'
              }`}
              title={isCollapsed ? item.name : undefined}
            >
              <div className="relative shrink-0">
                <Icon className="w-5 h-5" />
                {isWeatherTab && isRainHazard && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
              </div>

              {!isCollapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="truncate text-[0.9rem]">{item.name}</span>
                  {isWeatherTab && isRainHazard && (
                    <span className="flex items-center gap-1 text-[9px] font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded-full uppercase">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      Alert
                    </span>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </nav>

      {/* 3. Bottom Section: Weather Glance Micro-Widget & Audio / Status */}
      <div className="p-3 border-t border-slate-200 dark:border-slate-800/80 space-y-2.5 bg-slate-50/80 dark:bg-[#050B14]/40">
        {/* Weather Micro-Widget (Glanceable) */}
        <button
          type="button"
          onClick={() => onSelectTab('weather')}
          className={`w-full rounded-xl border transition-all text-left cursor-pointer ${
            isCollapsed
              ? 'p-2 flex flex-col items-center justify-center bg-white dark:bg-slate-950/60 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
              : 'p-2.5 flex items-center gap-2.5 bg-white dark:bg-slate-950/60 border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
          title="Click to open Weather Intelligence"
        >
          <WeatherMiniIcon className="w-5 h-5 text-teal-500 dark:text-teal-400 shrink-0" />
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                <span>{weather.temperature_c !== null ? `${Math.round(weather.temperature_c)}°C` : '--°C'}</span>
                <span className="text-[10px] font-mono text-teal-600 dark:text-teal-300 font-normal">
                  {weather.rainfall_mm.toFixed(1)} mm
                </span>
              </div>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {weather.is_online ? weather.condition : 'Local Weather Cache'}
              </p>
            </div>
          )}
        </button>

        {/* Connectivity & Emergency Siren Controls */}
        <div
          className={`flex items-center ${
            isCollapsed ? 'flex-col gap-2' : 'justify-between px-1'
          }`}
        >
          {/* Connection Status Indicator */}
          <div
            className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400"
            title="100% On-Premises Local Mode"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            {!isCollapsed && <span className="font-medium text-slate-700 dark:text-slate-300">Local Offline</span>}
          </div>

          {/* Emergency Siren Mute Toggle */}
          <div className="flex items-center">
            <button
              type="button"
              onClick={onToggleMute}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                isSirenMuted
                  ? 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  : 'bg-primary/10 dark:bg-primary/20 border-teal-500/30 text-teal-600 dark:text-teal-400 hover:bg-primary/20 dark:hover:bg-primary/30'
              }`}
              title={isSirenMuted ? 'Unmute Emergency Siren' : 'Mute Emergency Siren'}
              aria-label="Toggle siren audio"
            >
              {isSirenMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
};
