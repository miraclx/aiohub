// App-owned offline provenance/graph check; does not execute canonical modules.
import {readFile, readdir} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'source-manifest.json'), 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlob = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
if (manifest.commit !== 'ed8b085f081bc8442dc59ac9de4a4a2070b93f0a' || manifest.files.length !== 15) throw new Error('Unexpected source pin/closure');
const allowed = new Set(manifest.files.map(entry => entry.path.replace(/\.ts$/, '.js')));
for (const entry of manifest.files) {
  if (entry.path.includes('..') || entry.path.startsWith('/')) throw new Error('Invalid manifest path');
  const original = await readFile(resolve(root, 'upstream', entry.path));
  if (sha256(original) !== entry.sha256 || gitBlob(original) !== entry.gitBlob) throw new Error(`Original source changed: ${entry.path}`);
  const file = resolve(root, 'canonical', entry.path.replace(/\.ts$/, '.js'));
  const generated = await readFile(file, 'utf8');
  if (sha256(generated) !== entry.generatedSha256) throw new Error(`Generated source changed: ${entry.path}`);
  const ast = ts.createSourceFile(file, generated, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  for (const statement of ast.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier) {
      const target = statement.moduleSpecifier.text;
      if (target === 'buffer/index.js' && entry.path === 'formatters/engine/modifiers.ts') continue;
      const dependency = relative(resolve(root, 'canonical'), resolve(dirname(file), target));
      if (!target.startsWith('.') || !allowed.has(dependency)) throw new Error(`Out-of-closure import: ${entry.path} -> ${target}`);
    }
  }
  const scan = node => {
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require', 'fetch', 'eval', 'Function'].includes(node.expression.text)))) throw new Error(`Forbidden call in ${entry.path}`);
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ['Function', 'WebSocket', 'XMLHttpRequest', 'Worker'].includes(node.expression.text)) throw new Error(`Forbidden constructor in ${entry.path}`);
    ts.forEachChild(node, scan);
  };
  scan(ast);
}
const actual = (await readdir(resolve(root, 'canonical'), {recursive: true})).filter(path => path.endsWith('.js')).sort();
if (JSON.stringify(actual) !== JSON.stringify([...allowed].sort())) throw new Error('Unexpected generated files');
if (sha256(await readFile(resolve(root, 'LICENSE'))) !== manifest.licenseSha256) throw new Error('LICENSE changed');
console.log('Pinned 15-module provenance and runtime import graph verified; no canonical execution.');
