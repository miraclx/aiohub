import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  resolve: {alias: {'formatter-preview': fileURLToPath(new URL('./formatter-preview/src/client.ts', import.meta.url))}},
  worker: {format: 'es'},
  build: {outDir: 'dist', emptyOutDir: true, cssCodeSplit: false, rolldownOptions: {output: {codeSplitting: false, entryFileNames: 'app.js', assetFileNames: a => a.names?.some(n => n.endsWith('.css')) ? 'styles.css' : '[name][extname]'}}},
});
