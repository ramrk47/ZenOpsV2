module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        zen: {
          bg: 'var(--zen-bg)',
          text: 'var(--zen-text)',
          primary: 'var(--zen-primary)',
          highlight: 'var(--zen-highlight)',
          border: 'var(--zen-border)'
        }
      }
    }
  },
  plugins: []
};
