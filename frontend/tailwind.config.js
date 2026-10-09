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
        primary: '#0A3D62',
        accent: '#1ABC9C',
        background: '#F0F4F8',
        'background-dark': '#050B14',
        neutral: '#2C3E50',
        clear: '#2ECC71',
        partial: '#F39C12',
        blocked: '#E74C3C',
        eoc: {
          darkest: '#050B14',
          darker: '#0A1322',
          dark: '#0E1B2E',
          card: '#112038',
          border: '#1E314D',
          accent: '#1ABC9C',
          warning: '#F39C12',
          danger: '#E74C3C',
          success: '#2ECC71',
        }
      },
      fontFamily: {
        sans: [
          'Poppins',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Noto Sans',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      backgroundImage: {
        'dark-gradient': 'radial-gradient(circle at top, #111828 0%, #050B14 100%)',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0) 100%)',
      },
      keyframes: {
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
        'dropdown-in': {
          '0%': { opacity: '0', transform: 'translateY(-8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-slow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
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
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'dropdown-in': 'dropdown-in 0.15s ease-out',
        'pulse-slow': 'pulse-slow 3s ease-in-out infinite',
        'pulse-fast': 'pulseFast 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'alarm-glow': 'alarmGlow 0.8s ease-in-out infinite',
        'warning-glow': 'warningGlow 1.2s ease-in-out infinite',
      }
    },
  },
  plugins: [],
}
