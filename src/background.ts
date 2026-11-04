import type { BackgroundPreset } from './state';
import { mixHex, rgba } from './ui/format';

export interface BackgroundTheme {
  id: BackgroundPreset;
  label: string;
  a: string;
  b: string;
  c: string;
  glow1: string;
  glow2: string;
  grid: string;
}

export const BACKGROUNDS: Record<Exclude<BackgroundPreset, 'custom'>, BackgroundTheme> = {
  deep: {
    id: 'deep',
    label: '深空蓝',
    a: '#02060F',
    b: '#041225',
    c: '#0A2B4D',
    glow1: 'rgba(34, 120, 185, 0.22)',
    glow2: 'rgba(12, 74, 120, 0.26)',
    grid: 'rgba(92, 225, 255, 0.055)',
  },
  aurora: {
    id: 'aurora',
    label: '极光青',
    a: '#010C0D',
    b: '#032226',
    c: '#084450',
    glow1: 'rgba(62, 230, 196, 0.16)',
    glow2: 'rgba(24, 110, 108, 0.22)',
    grid: 'rgba(92, 255, 230, 0.055)',
  },
  gold: {
    id: 'gold',
    label: '黑金',
    a: '#050403',
    b: '#0D0A06',
    c: '#2A2110',
    glow1: 'rgba(246, 196, 83, 0.13)',
    glow2: 'rgba(120, 84, 26, 0.18)',
    grid: 'rgba(246, 196, 83, 0.045)',
  },
};

export function resolveBackground(preset: BackgroundPreset, custom: string): BackgroundTheme {
  if (preset !== 'custom') return BACKGROUNDS[preset];
  return {
    id: 'custom',
    label: '自定义',
    a: mixHex(custom, '#01040A', 0.84),
    b: mixHex(custom, '#01040A', 0.56),
    c: custom,
    glow1: rgba(custom, 0.28),
    glow2: rgba(custom, 0.18),
    grid: 'rgba(92, 225, 255, 0.05)',
  };
}
