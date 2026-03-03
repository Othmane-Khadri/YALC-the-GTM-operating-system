import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Space Mono"', 'monospace'],
        sans: ['"Space Mono"', 'monospace'],
      },
      colors: {
        // Clay fruit palette — dark mode adaptation
        background: '#0e0f14',
        surface: '#1a1b22',
        'surface-2': '#22232e',
        'surface-3': '#1d2026',
        border: '#2c2e3e',
        'border-subtle': '#1f2130',
        // Text
        'text-primary': '#f0f1f6',
        'text-secondary': '#8b91a8',
        'text-muted': '#4e5470',
        // Blueberry — primary brand
        blueberry: {
          50: '#1a2040',
          300: '#7fa0f8',
          600: '#4b72f5',
          800: '#2d4db8',
        },
        // Matcha — success
        matcha: {
          300: '#6ee7b0',
          600: '#22c578',
        },
        // Tangerine — warning
        tangerine: {
          300: '#fed7a0',
          600: '#f97316',
        },
        // Pomegranate — error
        pomegranate: {
          300: '#fca5a5',
          600: '#ef4444',
        },
        // Dragonfruit — tags/highlights
        dragonfruit: {
          200: '#f5cce8',
          800: '#be185d',
        },
        // Lemon — info
        lemon: {
          300: '#fef08a',
          600: '#ca8a04',
        },
        // Oat — neutral tints
        oat: {
          100: '#1e1f28',
          200: '#282a36',
        },
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
