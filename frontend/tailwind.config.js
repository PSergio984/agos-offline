/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        eoc: {
          darkest: '#080c14',
          darker: '#0d131f',
          dark: '#141d2e',
          card: '#182235',
          border: '#24324d',
          accent: '#06b6d4',
          warning: '#f59e0b',
          danger: '#ef4444',
          success: '#10b981',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      keyframes: {
        pulseFast: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(1.02)' },
        },
        alarmGlow: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(239, 68, 68, 0.6), inset 0 0 15px rgba(239, 68, 68, 0.4)' },
          '50%': { boxShadow: '0 0 35px rgba(239, 68, 68, 0.95), inset 0 0 25px rgba(239, 68, 68, 0.7)' },
        },
        warningGlow: {
          '0%, 100%': { boxShadow: '0 0 15px rgba(245, 158, 11, 0.5), inset 0 0 10px rgba(245, 158, 11, 0.3)' },
          '50%': { boxShadow: '0 0 30px rgba(245, 158, 11, 0.9), inset 0 0 20px rgba(245, 158, 11, 0.6)' },
        }
      },
      animation: {
        'pulse-fast': 'pulseFast 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'alarm-glow': 'alarmGlow 0.8s ease-in-out infinite',
        'warning-glow': 'warningGlow 1.2s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
