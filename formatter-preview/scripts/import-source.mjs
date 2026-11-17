// App-owned, data-only importer. Never imports/executes source or upstream scripts.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = process.argv[2];
if (!sourceRoot || !sourceRoot.startsWith('/')) throw new Error('Pass an absolute isolated source directory.');
const commit = 'ed8b085f081bc8442dc59ac9de4a4a2070b93f0a';
// GitHub blob hashes inspected at this exact commit; no discovery at build time.
const files = {
  'formatters/base.ts': '2692b17380b5dcfb216421ab4a111bedc1140d0e',
  'formatters/custom.ts': '7b1f2e1449fddcec2d1a06bf60dbddfc6a9422d2',
  'formatters/utils.ts': 'b484a495f8cdbf75d18fd634d6574c01d9c46fb2',
  'formatters/engine/ast.ts': '590233c06f970ad8085010e7e253ccf0aac4c5ca',
  'formatters/engine/comparators.ts': 'cc40b1e2594432adb852c6e1bb134b5c08de243a',
  'formatters/engine/compile.ts': 'eae39e046cf5a5d85750d254e6752a7e12686687',
  'formatters/engine/fields.ts': '230cd09e66415df72be465cb0ebf1de6eb1d3daa',
  'formatters/engine/modifiers.ts': '6dda4375266c7adb872fdd7a91deead7217a374e',
  'formatters/engine/parser.ts': '5d93122992d877ae7152f33b74aeb3f348bde8d1',
  'formatters/engine/sentinels.ts': 'a5ac97212395f3cc5d90aac620a6c1811690bd03',
  'utils/constants.ts': '3a943812515f6689e8a444f07175b45bea17f44b',
  'utils/languages.ts': '983caa854c01a5e052e521db2ee767cb11c2f990',
  'utils/language-list.ts': '03a1a34252cc88af775fd0b22cb2958d2f782da5',
  'utils/media-info.ts': 'a598d15d37883d9e3510644087ac679b326786bb',
  'utils/object-filter.ts': '57b61b970bf053579b5fb2bbbda77c25bc87bf77',
};
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const entries = await Promise.all(Object.entries(files).map(async ([path, blob]) => {
  const bytes = await readFile(resolve(sourceRoot, 'packages/core/src', path));
  if (gitBlob(bytes) !== blob) throw new Error(`Pinned source hash mismatch: ${path}`);
  return {path, blob, bytes};
}));
const license = await readFile(resolve(sourceRoot, 'LICENSE'));
if (gitBlob(license) !== '0ad25db4bd1d86c452db3f9602ccdbe172438f52') throw new Error('Pinned LICENSE mismatch');
const compilerOptions = {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: false, removeComments: false, newLine: ts.NewLineKind.LineFeed};
const manifest = {repository: 'https://github.com/Viren070/AIOStreams', version: 'v2.37.0', commit, license: 'AGPL-3.0-only', generatedAt: '2026-11-09', compiler: `typescript@${ts.version}`, transformations: ['TypeScript type erasure to ES2022 ESM; comments retained.', 'Explicit buffer import only in generated modifiers.js; no global Node polyfill.'], files: [], licenseSha256: sha256(license)};
for (const {path, blob, bytes} of entries) {
  const original = resolve(root, 'upstream', path);
  const generated = resolve(root, 'canonical', path.replace(/\.ts$/, '.js'));
  const source = bytes.toString('utf8');
  const compiled = ts.transpileModule(source, {fileName: path, compilerOptions, reportDiagnostics: true});
  if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error(`Type erasure failed: ${path}`);
  const shim = path === 'formatters/engine/modifiers.ts' ? "import { Buffer } from 'buffer/index.js';\n" : '';
  const output = `// Generated 2026-11-09 from AIOStreams ${commit}; AGPL-3.0-only.\n// Type erasure${shim ? ' and explicit browser Buffer import' : ''}; original source/notices in upstream/.\n${shim}${compiled.outputText}`;
  await mkdir(dirname(original), {recursive: true});
  await mkdir(dirname(generated), {recursive: true});
  await writeFile(original, bytes);
  await writeFile(generated, output);
  manifest.files.push({path, upstreamPath: `packages/core/src/${path}`, gitBlob: blob, bytes: bytes.length, sha256: sha256(bytes), generatedSha256: sha256(output)});
}
await writeFile(resolve(root, 'LICENSE'), license);
await writeFile(resolve(root, 'source-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Imported ${entries.length} hash-verified formatter modules as data; no upstream code executed.`);
