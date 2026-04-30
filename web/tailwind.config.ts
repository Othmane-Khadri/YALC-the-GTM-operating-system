import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'
import tokens from './brand/tokens.json'

// Single source of truth: brand/tokens.json. Every theme value below is
// derived from a token there — never hardcode brand values in this file.
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': tokens.spacing.containerMaxWidth },
    },
    extend: {
      colors: {
        background: tokens.colors.background,
        foreground: tokens.colors.foreground,
        primary: {
          DEFAULT: tokens.colors.primary,
          foreground: tokens.colors.accentForeground,
          light: tokens.colors.primaryLight,
        },
        secondary: {
          DEFAULT: tokens.colors.secondary[1],
          foreground: tokens.colors.background,
        },
        accent: {
          DEFAULT: tokens.colors.accent,
          foreground: tokens.colors.accentForeground,
        },
        destructive: {
          DEFAULT: tokens.colors.destructive,
          foreground: tokens.colors.destructiveForeground,
        },
        muted: {
          DEFAULT: tokens.colors.muted,
          foreground: tokens.colors.mutedForeground,
        },
        card: {
          DEFAULT: tokens.colors.card,
          foreground: tokens.colors.cardForeground,
        },
        border: tokens.colors.border,
        ring: tokens.colors.ring,
        inverse: {
          DEFAULT: tokens.colors.inverseBackground,
          foreground: tokens.colors.inverseForeground,
        },
      },
      fontFamily: {
        sans: [tokens.fonts.body],
        heading: [tokens.fonts.heading],
        mono: [tokens.fonts.mono],
      },
      borderRadius: {
        sm: tokens.radii.sm,
        md: tokens.radii.md,
        lg: tokens.radii.lg,
        xl: tokens.radii.xl,
      },
      boxShadow: {
        sm: tokens.shadows.sm,
        DEFAULT: tokens.shadows.md,
        md: tokens.shadows.md,
        lg: tokens.shadows.lg,
        xl: tokens.shadows.xl,
      },
      backgroundImage: {
        'brand-gradient': tokens.colors.primaryGradient,
      },
    },
  },
  plugins: [animate],
}

export default config
