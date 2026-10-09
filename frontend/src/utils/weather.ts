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

export type StatusCardType = 'good' | 'moderate' | 'bad';

export const getComfortType = (level?: string | null): StatusCardType => {
  const l = (level ?? '').toLowerCase();
  if (l === 'comfortable' || l === 'cool') return 'good';
  if (l === 'uncomfortable' || l === 'oppressive' || l === 'heat stress risk') return 'bad';
  return 'moderate';
};

export const getStormRiskType = (level?: string | null): StatusCardType => {
  const l = (level ?? '').toLowerCase();
  if (l === 'none' || l === 'low') return 'good';
  if (l === 'likely') return 'bad';
  return 'moderate';
};

export const getTimeAgo = (timestamp: string): string => {
  const seconds = Math.floor((new Date().getTime() - new Date(timestamp).getTime()) / 1000);
  if (Number.isNaN(seconds)) return 'never';
  if (seconds < 60) return 'Just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min${minutes > 1 ? 's' : ''} ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days > 1 ? 's' : ''} ago`;

  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;

  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? 's' : ''} ago`;
};

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
