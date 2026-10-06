export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#F7F3EC',
        surface: '#FFFDF9',
        ink: '#201A14',
        'ink-2': '#6E6459',
        'ink-3': '#A39888',
        line: '#E6DDD0',
        accent: { DEFAULT: '#E05A1F', soft: '#FBEADF', deep: '#93380F' },
        warn: { DEFAULT: '#B07C1F', soft: '#F5EDDA' },
        bad: { DEFAULT: '#B23B2E', soft: '#F7E9E5' },
        ok: { DEFAULT: '#4A7C59', soft: '#EAEFE8' },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', 'SimSun', 'serif'],
        sans: ['"PingFang SC"', '"HarmonyOS Sans SC"', '"Microsoft YaHei"', 'sans-serif'],
        num: ['Fraunces', '"Noto Serif SC"', 'serif'],
      },
      maxWidth: { prose: '760px' },
      borderRadius: { panel: '14px' },
      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
      },
      animation: {
        rise: 'rise 220ms ease-out both',
        blink: 'blink 1s step-end infinite',
      },
    },
  },
  plugins: [],
}
