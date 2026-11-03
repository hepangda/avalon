import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Shared medieval fantasy palette.
        parchment: {
          DEFAULT: '#e8dcc0',
          dim: '#c8bca0',
        },
        ink: {
          DEFAULT: '#221a12',
          deep: '#16100a',
        },
        gold: {
          DEFAULT: '#c9a227',
          bright: '#e6c14a',
          dim: '#8a6f1c',
        },
        crimson: {
          DEFAULT: '#8b2820',
          bright: '#b23a2e',
        },
        royal: '#2a3a6b',
        stone: {
          DEFAULT: '#3a3631',
          dark: '#2a2722',
        },
      },
      fontFamily: {
        serif: ['var(--font-cinzel)', 'Cinzel', 'Georgia', 'serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        candle: '0 0 28px -4px rgba(201, 162, 39, 0.35)',
        inset: 'inset 0 1px 0 0 rgba(255,255,255,0.06)',
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '45%': { opacity: '0.92' },
          '55%': { opacity: '0.97' },
        },
      },
      animation: {
        flicker: 'flicker 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
