import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, lstatSync, writeFileSync, mkdirSync, copyFileSync, realpathSync } from 'node:fs';
import { dirname, basename, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd(), groups = new Map(), missing = [];
const overrides = {
  'Rust alloc-stdlib 0.2.4': 'ALLOC-BSD.txt', 'Rust defmt-parser 1.0.0': 'DEFMT-MIT.txt',
  'Rust selectors 0.36.1': 'MPL-2.0.txt',
  ...Object.fromEntries(['unic-char-property','unic-char-range','unic-common','unic-ucd-ident','unic-ucd-version'].map(name => [`Rust ${name} 0.9.0`, 'UNIC-MIT.txt'])),
  'Rust webview2-com 0.38.2': 'WEBVIEW2-MIT.txt', 'Rust webview2-com-sys 0.38.2': 'WEBVIEW2-MIT.txt',
  'Rust webview2-com-macros 0.8.1': 'WEBVIEW2-MIT.txt',
};
function add(label, expression, text) {
  text = text.trim();
  const key = createHash('sha256').update(text).digest('hex');
  if (!groups.has(key)) groups.set(key, { text, packages: new Set() });
  groups.get(key).packages.add(`${label} (${expression ?? 'see license text'})`);
}
function collect(label, directory, expression, declared) {
  const paths = new Set();
  for (const folder of [directory, resolve(directory, 'licenses'), resolve(directory, 'LICENSES')]) {
    try {
      for (const name of readdirSync(folder)) if (/^(licen[sc]e|copying|notice|copyright|ofl|unlicense)(?:$|[._-])/i.test(name)) paths.add(resolve(folder, name));
    } catch {}
  }
  if (declared) paths.add(resolve(directory, declared));
  let found = false;
  for (const path of paths) {
    const child = relative(directory, path);
    if (child.startsWith('..') || isAbsolute(child)) continue;
    try {
      const metadata = lstatSync(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024 * 1024) continue;
      const actual = relative(realpathSync(directory), realpathSync(path));
      if (actual.startsWith('..') || isAbsolute(actual)) continue;
      const text = readFileSync(path, 'utf8').trim(); if (!text) continue;
      add(label, expression, text); found = true;
    } catch {}
  }
  if (!found && overrides[label]) { add(label, expression, readFileSync(resolve('licenses/overrides', overrides[label]), 'utf8')); found = true; }
  if (!found) missing.push(`${label}: ${expression ?? 'undeclared'}`);
}
const metadata = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'RemoteSigned', '-File',
  resolve('scripts/cargo.ps1'), 'metadata', '--format-version', '1', '--features', 'desktop', '--filter-platform', 'x86_64-pc-windows-msvc', '--locked'],
{ encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }));
const active = new Set(metadata.resolve.nodes.map(node => node.id));
const checksums = new Map(readFileSync('Cargo.lock', 'utf8').split('[[package]]').map(block => {
  const name = /^name = "([^"]+)"/m.exec(block)?.[1], version = /^version = "([^"]+)"/m.exec(block)?.[1];
  return [`${name}@${version}`, /^checksum = "([^"]+)"/m.exec(block)?.[1]];
}));
const archives = [];
for (const pkg of metadata.packages) if (pkg.source && active.has(pkg.id)) {
  const directory = dirname(pkg.manifest_path);
  collect(`Rust ${pkg.name} ${pkg.version}`, directory, pkg.license, pkg.license_file);
  if (pkg.license === 'MPL-2.0') {
    const filename = `${pkg.name}-${pkg.version}.crate`;
    const archive = resolve(directory, '../../..', 'cache', basename(dirname(directory)), filename);
    const hash = createHash('sha256').update(readFileSync(archive)).digest('hex');
    if (hash !== checksums.get(`${pkg.name}@${pkg.version}`)) throw new Error(`Source archive checksum mismatch: ${filename}`);
    mkdirSync('licenses/sources', { recursive: true }); copyFileSync(archive, resolve('licenses/sources', filename));
    archives.push({ file: filename, sha256: hash, source: `https://crates.io/crates/${pkg.name}/${pkg.version}` });
  }
}
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev || !path.startsWith('node_modules/')) continue;
  const directory = resolve(root, path);
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
  collect(`npm ${manifest.name} ${manifest.version}`, directory, manifest.license);
}
let output = 'LostCodexTheme Third-Party Dependency Licenses\n\nGenerated from locked Windows Cargo dependencies (including build dependencies) and production npm packages.\nLostCodexTheme itself is not assigned a license by this report.\nUnmodified source archives for MPL-2.0 dependencies are provided in licenses/sources.\n\n';
for (const entry of groups.values()) output += `${'='.repeat(78)}\n${[...entry.packages].sort().join('\n')}\n${'='.repeat(78)}\n\n${entry.text}\n\n`;
writeFileSync('THIRD_PARTY_DEPENDENCIES.txt', output);
writeFileSync('docs/license-audit.json', JSON.stringify({ groups: groups.size, missing, archives }, null, 2) + '\n');
if (missing.length) { process.stderr.write(`Missing license files:\n${missing.join('\n')}\n`); process.exitCode = 1; }
else process.stdout.write(`Collected ${groups.size} distinct license texts.\n`);
