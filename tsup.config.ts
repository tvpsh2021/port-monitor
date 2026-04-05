import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['index.tsx'],
  format: ['esm'],
  target: 'node18',
  banner: { js: '#!/usr/bin/env node' },
  clean: true,
  outDir: 'dist',
});
