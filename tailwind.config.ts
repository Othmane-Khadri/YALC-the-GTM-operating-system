import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"Space Mono"', 'monospace'],
        sans: ['"Space Mono"', 'monospace'],
      },
      colors: {
        background: '#F9F8F6',
        surface: '#F4F3F0',
        'surface-2': '#EEE9DF',
        'surface-3': '#FEFDFB',
        border: '#E6E8EC',
        'border-subtle': '#D1CDC7',
        'text-primary': '#1B1A18',
        'text-secondary': '#525A69',
        'text-muted': '#7B7974',
        blueberry: {
          50: '#E8EDFE',
          300: '#7FA0F8',
          600: '#3859F9',
          800: '#0053B5',
        },
        matcha: {
          50: '#E8F5EF',
          300: '#6ee7b0',
          600: '#02693E',
        },
        tangerine: {
          50: '#FEF3E8',
          300: '#fed7a0',
          600: '#FF7614',
          700: '#C34E1B',
        },
        pomegranate: {
          300: '#fca5a5',
          600: '#ef4444',
        },
        dragonfruit: {
          50: '#FCE7F6',
          200: '#fce7f6',
          600: '#8B045C',
          800: '#8B045C',
        },
        lemon: {
          50: '#FEFCE8',
          300: '#fef08a',
          600: '#CBD810',
        },
        oat: {
          100: '#F3F2ED',
          200: '#EEE9DF',
        },
      },
      animation: {
        'pulse-slow': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
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
