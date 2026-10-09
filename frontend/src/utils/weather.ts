import {
  Sun,
  Cloud,
  CloudRain,
  CloudDrizzle,
  CloudLightning,
  CloudSunRain,
  CloudFog,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const getWeatherIcon = (weatherCode?: number | null): LucideIcon => {
  if (weatherCode === undefined || weatherCode === null) return CloudSunRain;
  if (weatherCode === 0 || weatherCode === 1) return Sun;
  if (weatherCode === 2 || weatherCode === 3) return CloudSunRain;
  if (weatherCode >= 45 && weatherCode <= 48) return CloudFog;
  if (weatherCode >= 51 && weatherCode <= 57) return CloudDrizzle;
  if (weatherCode >= 61 && weatherCode <= 67) return CloudRain;
  if (weatherCode >= 80 && weatherCode <= 82) return CloudRain;
  if (weatherCode >= 95 && weatherCode <= 99) return CloudLightning;
  return Cloud;
};

export const getWeatherDescription = (code?: number | null): string => {
  if (code === undefined || code === null) return 'Offline Weather Cache';
  if (code === 0) return 'Clear Sky';
  if (code === 1) return 'Mainly Clear';
  if (code === 2) return 'Partly Cloudy';
  if (code === 3) return 'Overcast';
  if (code >= 45 && code <= 48) return 'Foggy';
  if (code >= 51 && code <= 55) return 'Light Drizzle';
  if (code >= 61 && code <= 65) return 'Rain Showers';
  if (code >= 80 && code <= 82) return 'Heavy Rain';
  if (code >= 95) return 'Thunderstorm';
  return 'Cloudy';
};

export interface RainTier {
  label: string;
  colorClass: string;
  bgClass: string;
  borderClass: string;
  isHazard: boolean;
}

export const getRainTier = (rainfall_mm: number): RainTier => {
  if (rainfall_mm === 0) {
    return {
      label: 'No Rain',
      colorClass: 'text-emerald-400',
      bgClass: 'bg-emerald-500/10',
      borderClass: 'border-emerald-500/20',
      isHazard: false,
    };
  }
  if (rainfall_mm < 2.5) {
    return {
      label: 'Light Rain',
      colorClass: 'text-teal-400',
      bgClass: 'bg-teal-500/10',
      borderClass: 'border-teal-500/20',
      isHazard: false,
    };
  }
  if (rainfall_mm < 7.5) {
    return {
      label: 'Moderate Rain',
      colorClass: 'text-blue-400',
      bgClass: 'bg-blue-500/10',
      borderClass: 'border-blue-500/20',
      isHazard: false,
    };
  }
  if (rainfall_mm < 15.0) {
    return {
      label: 'Heavy Rain',
      colorClass: 'text-amber-400',
      bgClass: 'bg-amber-500/10',
      borderClass: 'border-amber-500/30',
      isHazard: false,
    };
  }
  return {
    label: 'Torrential Rain Hazard',
    colorClass: 'text-rose-400',
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/30',
    isHazard: true,
  };
};
