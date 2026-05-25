/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.html", "./scripts/**/*.js"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#2563eb',
          dark: '#1d4ed8',
        },
        good: '#059669',
        warn: '#d97706',
        bad: '#dc2626',
        chip: '#eff6ff',
        muted: '#64748b',
        line: '#e2e8f0',
        panel: '#ffffff',
        bg: '#f8fafc',
      },
      borderRadius: {
        custom: '20px',
      },
      boxShadow: {
        custom: '0 20px 40px rgba(15, 23, 42, 0.08)',
      }
    },
  },
  plugins: [],
}
