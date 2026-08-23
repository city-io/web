import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],

  theme: {
    extend: {
      colors: {
        // Warm Civ2 parchment/stone greys — the backbone of every panel.
        stone: {
          50: '#f6efe0',
          100: '#eaddc4',
          200: '#d8c39c',
          300: '#c0a878',
          400: '#a08a5c',
          500: '#7e6b45',
          600: '#5e4f33',
          700: '#453a26',
          800: '#2f281b',
          900: '#1d1811'
        },
        // Bronze / gold accents for borders, rivets and highlights.
        bronze: {
          300: '#e8c37a',
          400: '#d4a54a',
          500: '#b5842f',
          600: '#8f6420',
          700: '#6b4a17'
        },
        parchment: '#efe2c4'
      },
      fontFamily: {
        sans: ['Tahoma', 'Verdana', 'Arial', 'sans-serif'],
        display: ['Georgia', '"Times New Roman"', 'serif']
      },
      boxShadow: {
        // Raised beveled stone/metal: bright top-left, dark bottom-right.
        bevel: 'inset 2px 2px 0 0 rgba(255,241,214,0.35), inset -2px -2px 0 0 rgba(0,0,0,0.55), 0 3px 10px rgba(0,0,0,0.45)',
        // Pressed/inset well for fields and recessed areas.
        'bevel-inset': 'inset 2px 2px 0 0 rgba(0,0,0,0.5), inset -2px -2px 0 0 rgba(255,241,214,0.2)'
      },
      borderRadius: {
        // Blocky, retro corners.
        panel: '4px'
      }
    }
  },

  plugins: []
} satisfies Config;
