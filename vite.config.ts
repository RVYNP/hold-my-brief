import { defineConfig } from 'vite';
export default defineConfig({
  clearScreen: false,
  build: {
    target: 'es2022',
    rolldownOptions: { input: { reader: 'index.html', library: 'library.html' } },
  },
  server: { strictPort: true, port: 1420 },
});
