// Prints the Home a new hub starts with (defaultRows in src/data.ts), as JSON, exactly as the hub stores it: its `rows`.
// For bringing a hub made before the default changed to it by hand. Reads only this repo: no network, no secrets.
// Usage: node scripts/default-home.mjs [--no-for-you]   (--no-for-you: a hub without AIOMetadata in front has no For you places)
import {build} from 'esbuild';
const out = await build({entryPoints: [new URL('../src/data.ts', import.meta.url).pathname], bundle: true, format: 'esm', write: false, logLevel: 'silent', loader: {'.json': 'json'}});
const data = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
console.log(JSON.stringify(data.defaultRows(!process.argv.includes('--no-for-you')), null, 2));
