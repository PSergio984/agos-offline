import React from 'react';
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
} from 'lucide-react';
import { getWeatherIcon } from '../utils/weather';
import { RainHazard } from '../types';

export type NavTabId = 'monitoring' | 'weather' | 'incidents' | 'diagnostics';

interface SidebarProps {
  isCollapsed: boolean;
  onToggle: () => void;
  activeTab: NavTabId;
  onSelectTab: (tab: NavTabId) => void;
  weather: {
    is_online: boolean;
    rainfall_mm: number;
    temperature_c: number | null;
    condition: string;
    weather_code?: number | null;
    rain_hazard?: RainHazard;
  };
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
      className={`fixed top-0 bottom-0 left-0 z-40 flex flex-col border-r border-slate-800/80 bg-[#070D18]/95 backdrop-blur-xl transition-all duration-300 select-none ${
        isCollapsed ? 'w-20' : 'w-56'
      }`}
    >
      {/* 1. Header / Brand & Toggle */}
      <div className="h-16 px-4 flex items-center justify-between border-b border-slate-800/70">
        {!isCollapsed && (
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-primary/25 border border-teal-500/30 shrink-0">
              <img src="/agos.svg" alt="AGOS" className="w-5 h-5 object-contain" />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-bold text-base tracking-tight text-white leading-none">
                AGOS
              </span>
              <span className="text-[10px] text-teal-400 font-medium tracking-wider uppercase mt-0.5">
                Offline
              </span>
            </div>
          </div>
        )}

        {isCollapsed && (
          <div className="mx-auto">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/25 border border-teal-500/30">
              <img src="/agos.svg" alt="AGOS" className="w-5 h-5 object-contain" />
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onToggle}
          className={`p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer ${
            isCollapsed ? 'hidden' : 'block'
          }`}
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Collapse button when collapsed */}
      {isCollapsed && (
        <div className="py-2 flex justify-center border-b border-slate-800/40">
          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors cursor-pointer"
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 2. Navigation Items */}
      <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const isWeatherTab = item.id === 'weather';

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`w-full flex items-center rounded-xl transition-all cursor-pointer group ${
                isCollapsed ? 'justify-center p-3' : 'px-3.5 py-2.5 gap-3'
              } ${
                isActive
                  ? 'bg-primary text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-medium'
              }`}
              title={isCollapsed ? item.name : undefined}
            >
              <div className="relative shrink-0">
                <Icon
                  className={`w-5 h-5 transition-transform group-hover:scale-105 ${
                    isActive ? 'text-teal-300' : 'text-slate-400 group-hover:text-slate-200'
                  }`}
                />
                {isWeatherTab && isRainHazard && (
                  <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                )}
              </div>

              {!isCollapsed && (
                <div className="flex items-center justify-between flex-1 min-w-0">
                  <span className="truncate text-xs tracking-tight">{item.name}</span>
                  {isWeatherTab && isRainHazard && (
                    <span className="flex items-center gap-1 text-[9px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30 px-1.5 py-0.5 rounded-full uppercase">
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
      <div className="p-3 border-t border-slate-800/80 space-y-2.5 bg-[#050B14]/40">
        {/* Weather Micro-Widget (Glanceable) */}
        <button
          type="button"
          onClick={() => onSelectTab('weather')}
          className={`w-full rounded-xl border transition-all text-left cursor-pointer ${
            isCollapsed
              ? 'p-2 flex flex-col items-center justify-center bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
              : 'p-2.5 flex items-center gap-2.5 bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
          }`}
          title="Click to open Weather Intelligence"
        >
          <WeatherMiniIcon className="w-5 h-5 text-teal-400 shrink-0" />
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-200">
                <span>{weather.temperature_c !== null ? `${Math.round(weather.temperature_c)}°C` : '--°C'}</span>
                <span className="text-[10px] font-mono text-teal-300 font-normal">
                  {weather.rainfall_mm.toFixed(1)} mm
                </span>
              </div>
              <p className="text-[10px] text-slate-400 truncate mt-0.5">
                {weather.is_online ? weather.condition : 'Local Weather Cache'}
              </p>
            </div>
          )}
        </button>

        {/* Connectivity & Siren Controls */}
        <div
          className={`flex items-center ${
            isCollapsed ? 'flex-col gap-2' : 'justify-between px-1'
          }`}
        >
          {/* Connection Status Indicator */}
          <div
            className="flex items-center gap-2 text-[11px] text-slate-400"
            title="100% On-Premises Local Mode"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            {!isCollapsed && <span className="font-medium text-slate-300">Local Offline</span>}
          </div>

          {/* Emergency Siren Mute Toggle */}
          <button
            type="button"
            onClick={onToggleMute}
            className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
              isSirenMuted
                ? 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'
                : 'bg-primary/20 border-teal-500/30 text-teal-400 hover:bg-primary/30'
            }`}
            title={isSirenMuted ? 'Unmute Emergency Siren' : 'Mute Emergency Siren'}
            aria-label="Toggle siren audio"
          >
            {isSirenMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </aside>
  );
};
