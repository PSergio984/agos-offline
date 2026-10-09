import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Droplets,
  Gauge,
  Navigation,
  RefreshCw,
  Smile,
  Thermometer,
  Wind,
} from 'lucide-react';
import Container from './ui/Container';
import { getWeatherIcon, getComfortType, getStormRiskType, getTimeAgo } from '../utils/weather';
import { WeatherSnapshot } from '../types';
import { setHazardOverride } from '../services/api';

interface WeatherViewProps {
  weather: WeatherSnapshot;
  onRefresh: () => Promise<void>;
}

const QuickStat: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}> = ({ icon: Icon, label, value }) => {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Icon className="h-4 w-4 shrink-0 text-gray-400 dark:text-slate-500" />
      <span className="min-w-0 flex-1 truncate text-gray-500 dark:text-slate-400">{label}</span>
      <span className="shrink-0 font-medium text-gray-700 dark:text-slate-200">{value}</span>
    </div>
  );
};

const DetailCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  subtitle: string;
}> = ({ icon: Icon, title, value, subtitle }) => {
  return (
    <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl rounded-2xl p-5 shadow-lg border border-white/50 dark:border-white/10 transition-all duration-300 hover:shadow-xl hover:dark:border-white/20">
      <div className="flex items-center gap-2.5 mb-3 min-w-0">
        <div className="p-2 rounded-lg bg-gray-100 dark:bg-white/5">
          <Icon className="h-4 w-4 shrink-0 text-gray-500 dark:text-slate-400" />
        </div>
        <span className="truncate text-xs font-bold uppercase tracking-widest text-gray-500 dark:text-slate-500">
          {title}
        </span>
      </div>
      <p className="break-words text-2xl font-bold text-gray-900 dark:text-slate-100 tracking-tight">{value}</p>
      <p className="truncate text-xs font-medium text-gray-500 dark:text-slate-400 mt-1">{subtitle}</p>
    </div>
  );
};

const StatusCard: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  type: 'good' | 'moderate' | 'bad';
}> = ({ icon: Icon, title, value, type }) => {
  const colors = {
    good: 'bg-emerald-500/10 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 dark:border-emerald-500/30',
    moderate: 'bg-amber-500/10 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 dark:border-amber-500/30',
    bad: 'bg-red-500/10 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20 dark:border-red-500/30',
  };

  return (
    <div className={`backdrop-blur-md shadow-lg min-w-0 rounded-2xl border p-5 transition-all duration-300 ${colors[type]}`}>
      <div className="mb-2 flex min-w-0 items-center gap-2.5">
        <Icon className="h-5 w-5 shrink-0" />
        <span className="min-w-0 truncate text-xs font-bold uppercase tracking-widest opacity-70">
          {title}
        </span>
      </div>
      <p className="break-words text-xl font-bold tracking-tight">{value}</p>
    </div>
  );
};

export const WeatherView: React.FC<WeatherViewProps> = ({ weather, onRefresh }) => {
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isOverriding, setIsOverriding] = useState<boolean>(false);

  const WeatherIcon = getWeatherIcon(weather.weather_code);
  const isHazardActive = weather.rain_hazard?.active ?? false;
  const hazardSource = weather.rain_hazard?.source ?? 'auto';

  const [timeAgo, setTimeAgo] = useState<string>(
    weather.timestamp ? getTimeAgo(weather.timestamp) : '--'
  );

  useEffect(() => {
    if (!weather.timestamp) {
      setTimeAgo('--');
      return;
    }
    const timestamp = weather.timestamp;
    setTimeAgo(getTimeAgo(timestamp));
    const intervalId = setInterval(() => {
      setTimeAgo(getTimeAgo(timestamp));
    }, 60 * 1000);
    return () => clearInterval(intervalId);
  }, [weather.timestamp]);

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
    <div className="space-y-4 font-sans">
      {/* Slim action row: feed badge + refresh (offline needs manual refresh) */}
      <div className="flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${
            weather.is_online
              ? 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800'
              : 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800'
          }`}
        >
          <span className="uppercase tracking-wide">
            {weather.is_online ? 'Live Weather Feed' : 'Offline Saved Weather'}
          </span>
        </span>
        <button
          type="button"
          onClick={handleManualRefresh}
          disabled={isRefreshing}
          className="btn-cancel flex items-center gap-2 !py-2"
          title="Refresh weather data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Main Display (agos-admin Weather MainDisplay) */}
      <div className="bg-white/60 dark:bg-white/[0.03] backdrop-blur-xl overflow-hidden rounded-2xl p-6 sm:p-8 border border-white/50 dark:border-white/10 shadow-xl transition-all duration-300 hover:shadow-2xl hover:dark:border-white/20">
        <div className="mb-5 flex items-start justify-between gap-3 sm:mb-6">
          <div className="min-w-0">
            <p className="truncate text-sm text-gray-500 dark:text-slate-400">
              {weather.location ?? 'Valenzuela City'}
            </p>
            <p className="truncate text-xs text-gray-400 dark:text-slate-500">Updated {timeAgo}</p>
          </div>

          {/* Rain hazard badge */}
          <div className="flex flex-col items-end gap-2 shrink-0">
            <span
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider border flex items-center gap-2 ${
                isHazardActive
                  ? 'bg-rose-50 text-rose-700 border-rose-300 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/40 shadow-md animate-pulse'
                  : 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
              }`}
            >
              {isHazardActive ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                  <span>Heavy Rain Alert Active</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Normal (No Flood Risk)</span>
                </>
              )}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Trigger: {hazardSource === 'override' ? 'Operator Manual Alert' : 'Automatic Radar (≥ 15.0 mm/hr)'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <WeatherIcon className="h-20 w-20 shrink-0 text-primary sm:h-24 sm:w-24" />
          <div className="min-w-0">
            <p className="text-5xl font-light leading-none text-gray-800 dark:text-slate-100 sm:text-6xl">
              {weather.temperature_c !== null ? `${Math.round(weather.temperature_c)}°` : '--'}
            </p>
            <p className="mt-1 truncate text-xl font-medium text-gray-700 dark:text-slate-200 sm:text-2xl">
              {weather.is_online ? weather.condition : 'Offline Mode'}
            </p>
            <p className="mt-1 truncate text-sm text-gray-500 dark:text-slate-400">
              {weather.temperature_description ?? '—'} · {weather.cloudiness ?? '—'}
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-8 grid grid-cols-1 gap-4 border-t border-gray-100 dark:border-white/5 pt-8 sm:grid-cols-3 sm:gap-6">
          <QuickStat
            icon={Droplets}
            label="Precipitation"
            value={`${weather.rainfall_mm.toFixed(1)} mm`}
          />
          <QuickStat
            icon={Gauge}
            label="Humidity"
            value={weather.humidity_pct !== null ? `${Math.round(weather.humidity_pct)}%` : '--'}
          />
          <QuickStat
            icon={Wind}
            label="Wind"
            value={weather.wind_speed_kmh != null ? `${weather.wind_speed_kmh} km/h` : '--'}
          />
        </div>
      </div>

      {/* Details Grid (agos-admin DetailCards) */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <DetailCard
          icon={Thermometer}
          title="Temperature"
          value={weather.temperature_c !== null ? `${weather.temperature_c.toFixed(1)}°C` : '--'}
          subtitle={weather.temperature_description ?? '—'}
        />
        <DetailCard
          icon={Droplets}
          title="Precipitation"
          value={`${weather.rainfall_mm.toFixed(1)} mm`}
          subtitle={weather.precipitation_description ?? '—'}
        />
        <DetailCard
          icon={Gauge}
          title="Humidity"
          value={weather.humidity_pct !== null ? `${Math.round(weather.humidity_pct)}%` : '--'}
          subtitle={weather.humidity_level ?? '—'}
        />
        <DetailCard
          icon={Wind}
          title="Wind Speed"
          value={weather.wind_speed_kmh != null ? `${weather.wind_speed_kmh} km/h` : '--'}
          subtitle={weather.wind_category ?? '—'}
        />
        <DetailCard
          icon={Navigation}
          title="Wind Direction"
          value={weather.wind_direction_label ?? '--'}
          subtitle={weather.wind_direction_degrees != null ? `${weather.wind_direction_degrees}°` : '—'}
        />
        <DetailCard
          icon={Cloud}
          title="Cloud Cover"
          value={weather.cloud_cover_percent != null ? `${weather.cloud_cover_percent}%` : '--'}
          subtitle={weather.cloudiness ?? '—'}
        />
      </div>

      {/* Status Row (agos-admin Comfort + Storm Risk) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatusCard
          icon={Smile}
          title="Comfort Level"
          value={weather.comfort_level ?? '--'}
          type={getComfortType(weather.comfort_level)}
        />
        <StatusCard
          icon={AlertTriangle}
          title="Storm Risk"
          value={weather.storm_risk_level ?? '--'}
          type={getStormRiskType(weather.storm_risk_level)}
        />
      </div>

      {/* Operator panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Manual Rain Alert (hazard override) */}
        <Container headerTitle="Manual Rain Alert">
          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            If it starts raining hard outside, click this button to warn the cleaning team right away without waiting for radar updates.
          </p>

          <div className="flex flex-wrap items-center gap-3 pt-3">
            <button
              type="button"
              onClick={handleToggleHazardOverride}
              disabled={isOverriding}
              className={`btn-custom text-xs font-semibold ${
                isHazardActive
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  : 'bg-rose-600 hover:bg-rose-500 text-white shadow-md'
              }`}
            >
              {isHazardActive ? 'Turn OFF Rain Alert' : 'Turn ON Rain Alert'}
            </button>

            {hazardSource === 'override' && (
              <button
                type="button"
                onClick={handleResetHazardAuto}
                disabled={isOverriding}
                className="btn-cancel !py-2 text-xs"
              >
                Reset to Auto
              </button>
            )}
          </div>
        </Container>

        {/* Drainage Flow & Rainfall Advisory Matrix */}
        <Container headerTitle="Rain Guide & What to Do">
          <div className="space-y-2 text-xs">
            <div className="p-2.5 rounded-xl bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/10 flex items-center justify-between">
              <span className="font-medium text-slate-700 dark:text-slate-300">&lt; 2.5 mm/hr · Light Rain</span>
              <span className="text-teal-700 dark:text-teal-400 font-semibold">Normal water flow</span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/10 flex items-center justify-between">
              <span className="font-medium text-slate-700 dark:text-slate-300">2.5 - 7.5 mm/hr · Moderate Rain</span>
              <span className="text-blue-700 dark:text-blue-400 font-semibold">Watch canal for trash</span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/10 flex items-center justify-between">
              <span className="font-medium text-slate-700 dark:text-slate-300">7.5 - 15.0 mm/hr · Heavy Rain</span>
              <span className="text-amber-700 dark:text-amber-400 font-semibold">Prepare gates & tools</span>
            </div>
            <div className="p-2.5 rounded-xl bg-white/40 dark:bg-white/[0.02] border border-gray-200/50 dark:border-white/10 flex items-center justify-between">
              <span className="font-medium text-slate-700 dark:text-slate-300">&gt; 15.0 mm/hr · Torrential</span>
              <span className="text-rose-700 dark:text-rose-400 font-bold">Send cleaning team now!</span>
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
};
