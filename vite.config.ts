import {defineConfig} from 'vite';
export default defineConfig({
  // One file for the site. The preview's pretend hub (src/sample, loaded only for an address ending in ?sample) is the one other.
  build: {outDir: 'dist', emptyOutDir: true, cssCodeSplit: false, rolldownOptions: {output: {entryFileNames: 'app.js', chunkFileNames: 'sample-[name].js', assetFileNames: a => a.names?.some(n => n.endsWith('.css')) ? 'styles.css' : '[name][extname]'}}},
});
