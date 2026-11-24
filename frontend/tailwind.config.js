/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#142238',
        muted: '#7f8ba0',
        mint: '#59d5ad',
        canvas: '#f3f6fa',
      },
      boxShadow: { panel: '0 8px 28px rgba(23,42,71,.06)' },
      borderRadius: { panel: '18px' },
    },
  },
  plugins: [],
};
