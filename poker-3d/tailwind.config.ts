import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        felt: '#0d5e2e',
        'felt-dark': '#0a4a24',
        gold: '#d4a843',
        'casino-red': '#c0392b',
        'casino-dark': '#0a0a1a',
      },
    },
  },
  plugins: [],
}
export default config
