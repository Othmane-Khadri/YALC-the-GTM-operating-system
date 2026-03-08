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
        sans: ['var(--font-inter)', 'Inter', 'sans-serif'],
        display: ['var(--font-dm-sans)', 'DM Sans', 'sans-serif'],
        mono: ['monospace'],
      },
      colors: {
        // Backgrounds
        background: '#f7f7f5',
        surface: '#f7f7f5',
        'surface-2': '#f2f0e9',
        'surface-3': '#ffffff',

        // Borders
        border: '#eeeeee',
        'border-subtle': '#e4e4e0',

        // Text
        'text-primary': '#111111',
        'text-secondary': '#666666',
        'text-muted': '#767676',

        // Primary accent
        accent: {
          DEFAULT: '#d63384',
          dark: '#8b1a5c',
          light: '#fce7f6',
        },

        // Success
        success: {
          DEFAULT: '#16a34a',
          light: '#e8f5ef',
        },

        // Warning
        warning: {
          DEFAULT: '#f59e0b',
          dark: '#b45309',
          light: '#fef3e8',
        },

        // Error
        error: {
          DEFAULT: '#ef4444',
          light: '#fef2f2',
        },
      },
      borderRadius: {
        card: '24px',
      },
      boxShadow: {
        card: '0 2px 2px rgba(0, 0, 0, 0.05)',
        'card-hover': '0 4px 12px rgba(0, 0, 0, 0.08)',
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
