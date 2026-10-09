import React, { useState } from 'react';
import {
  CloudRain,
  Droplets,
  Gauge,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  MapPin,
  Waves,
} from 'lucide-react';
import { getWeatherIcon, getRainTier } from '../utils/weather';
import { RainHazard } from '../types';
import { setHazardOverride } from '../services/api';

interface WeatherViewProps {
  weather: {
    is_online: boolean;
    rainfall_mm: number;
    temperature_c: number | null;
    humidity_pct: number | null;
    condition: string;
    message: string;
    cached?: boolean;
    weather_code?: number | null;
    rain_hazard?: RainHazard;
  };
  onRefresh: () => Promise<void>;
}

export const WeatherView: React.FC<WeatherViewProps> = ({ weather, onRefresh }) => {
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isOverriding, setIsOverriding] = useState<boolean>(false);

  const WeatherIcon = getWeatherIcon(weather.weather_code);
  const rainTier = getRainTier(weather.rainfall_mm);
  const isHazardActive = weather.rain_hazard?.active ?? false;
  const hazardSource = weather.rain_hazard?.source ?? 'auto';

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleToggleHazardOverride = async () => {
    setIsOverriding(true);
    try {
      const nextOverride = isHazardActive ? false : true;
      await setHazardOverride(nextOverride);
      await onRefresh();
    } finally {
      setIsOverriding(false);
    }
  };

  const handleResetHazardAuto = async () => {
    setIsOverriding(true);
    try {
      await setHazardOverride(null);
      await onRefresh();
    } finally {
      setIsOverriding(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto font-sans">
      {/* 1. Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-white tracking-tight">Weather Intelligence</h2>
            <span
              className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full border ${
                weather.is_online
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
              }`}
            >
              {weather.is_online ? 'Live Meteorological Feed' : 'Local Offline Cache'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-teal-400" />
            <span>Metro Manila · PAGASA Drainage Sector Inflow</span>
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-medium transition-colors cursor-pointer"
            title="Refresh weather data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-teal-400' : 'text-teal-400'}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* 2. Hero Weather Display Card (Matching agos-admin MainDisplay) */}
      <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-6 sm:p-8 backdrop-blur-md shadow-xl relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute top-0 right-0 w-80 h-80 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
          {/* Left: Weather Icon & Temperature */}
          <div className="flex items-center gap-6">
            <div className="p-4 rounded-2xl bg-primary/20 border border-teal-500/30 text-teal-300 shadow-lg">
              <WeatherIcon className="w-16 h-16 sm:w-20 sm:h-20" />
            </div>
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-5xl sm:text-6xl font-light text-white tracking-tight">
                  {weather.temperature_c !== null ? Math.round(weather.temperature_c) : '--'}
                </span>
                <span className="text-2xl font-light text-teal-400">°C</span>
              </div>
              <h3 className="text-xl font-semibold text-slate-100 mt-1">
                {weather.is_online ? weather.condition : 'Local Cached Conditions'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {weather.message}
              </p>
            </div>
          </div>

          {/* Right: Rain Hazard Badge */}
          <div className="flex flex-col items-start md:items-end gap-2">
            <span
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider border flex items-center gap-2 ${
                isHazardActive
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-lg shadow-rose-950/50 animate-pulse'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              }`}
            >
              {isHazardActive ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  <span>Rain Hazard Active</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>Normal Precipitation</span>
                </>
              )}
            </span>
            <span className="text-[11px] text-slate-400">
              Hazard Source: {hazardSource === 'override' ? 'Operator Manual Override' : 'Automated Threshold (≥ 15.0 mm/hr)'}
            </span>
          </div>
        </div>

        {/* Quick Stats Grid */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-teal-500/10 text-teal-400 border border-teal-500/20">
              <CloudRain className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Precipitation Rate</span>
              <span className="text-lg font-bold text-white font-mono">
                {weather.rainfall_mm.toFixed(1)} mm/hr
              </span>
            </div>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Droplets className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Relative Humidity</span>
              <span className="text-lg font-bold text-white font-mono">
                {weather.humidity_pct !== null ? `${Math.round(weather.humidity_pct)}%` : '80%'}
              </span>
            </div>
          </div>

          <div className="bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 flex items-center gap-3">
            <div className={`p-2.5 rounded-lg ${rainTier.bgClass} ${rainTier.colorClass} border ${rainTier.borderClass}`}>
              <Gauge className="w-5 h-5" />
            </div>
            <div>
              <span className="text-xs text-slate-400 block">Rainfall Tier</span>
              <span className={`text-base font-bold ${rainTier.colorClass}`}>
                {rainTier.label}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Operator Rain Hazard Control & Flood SOP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Hazard Override Panel */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md shadow-lg space-y-4">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-teal-400" />
            <h4 className="font-bold text-sm text-white">Operator Rain Hazard Control</h4>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            During typhoons or localized downpours, operators can manually declare or clear a rain hazard alert to warn mobile declogging crews regardless of radar latency.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleToggleHazardOverride}
              disabled={isOverriding}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isHazardActive
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md'
              }`}
            >
              {isHazardActive ? 'Deactivate Hazard Alert' : 'Force Declare Rain Hazard Alert'}
            </button>

            {hazardSource === 'override' && (
              <button
                type="button"
                onClick={handleResetHazardAuto}
                disabled={isOverriding}
                className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-teal-300 border border-slate-800 text-xs font-medium transition-colors cursor-pointer"
              >
                Reset to Automatic Threshold
              </button>
            )}
          </div>
        </div>

        {/* Drainage Flow & Rainfall Advisory Matrix */}
        <div className="bg-[#0B1526]/80 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-md shadow-lg space-y-4">
          <div className="flex items-center gap-2.5">
            <Waves className="w-5 h-5 text-teal-400" />
            <h4 className="font-bold text-sm text-white">PAGASA Hydrological Inflow Matrix</h4>
          </div>

          <div className="space-y-2 text-xs">
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span className="font-medium text-slate-300">&lt; 2.5 mm/hr · Light Rain</span>
              <span className="text-teal-400 font-medium">Standard Grate Intake</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span className="font-medium text-slate-300">2.5 - 7.5 mm/hr · Moderate Rain</span>
              <span className="text-blue-400 font-medium">Elevated Waste Accumulation</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span className="font-medium text-slate-300">7.5 - 15.0 mm/hr · Heavy Rain</span>
              <span className="text-amber-400 font-medium">Sluice Preparation Active</span>
            </div>
            <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
              <span className="font-medium text-slate-300">&gt; 15.0 mm/hr · Torrential</span>
              <span className="text-rose-400 font-bold">Immediate Declogging Alert</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
