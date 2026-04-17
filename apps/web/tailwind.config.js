/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        xl: 'var(--radius-xl)',
      },
    },
  },
  plugins: [],
};
