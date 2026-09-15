import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Preprocess and inspect the installer. Never execute the generated setup program.
const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const directory = resolve('target/release/nsis/x64');
const evidence = resolve('artifacts/package');
const nsis = resolve(process.env.LOCALAPPDATA, 'tauri/NSIS');
// NSIS -PPO does not register !addplugindir entries. Use the same verified plugin
// in its standard tooling-cache directory; never replace an existing different DLL.
const additional = resolve(nsis, 'Plugins/x86-unicode/additional/nsis_tauri_utils.dll');
const standard = resolve(nsis, 'Plugins/x86-unicode/nsis_tauri_utils.dll');
if (!existsSync(standard)) copyFileSync(additional, standard, constants.COPYFILE_EXCL);
assert.deepEqual(readFileSync(standard), readFileSync(additional), 'NSIS preprocessing plugin differs');
const env = { ...process.env }; delete env.NSISDIR; delete env.NSISCONFDIR;
const preprocessing = spawnSync(resolve(nsis, 'makensis.exe'),
  ['-INPUTCHARSET', 'UTF8', '-OUTPUTCHARSET', 'UTF8', '-PPO', 'installer.nsi'],
  { cwd: directory, env, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (preprocessing.error) throw preprocessing.error;
assert.equal(preprocessing.status, 0, preprocessing.stderr);
assert.doesNotMatch(preprocessing.stderr, /warning|unknown variable|unknown constant/i);
const expanded = preprocessing.stdout;
assert.doesNotMatch(expanded, /nsis_tauri_utils::KillProcess/);
assert.doesNotMatch(expanded, /\$\{(?:PRODUCTNAME|LCT_PRODUCT_NAME)\}/);
assert.ok(expanded.includes(`$LOCALAPPDATA\\Programs\\${config.productName}`));
assert.ok(expanded.includes('Choose an installation directory outside the theme data directory.'));
assert.ok((expanded.match(/nsis_tauri_utils::FindProcessCurrentUser/g) ?? []).length >= 2);

const source = readFileSync(resolve(directory, 'installer.nsi'), 'utf8');
for (const resource of ['THIRD_PARTY_DEPENDENCIES.txt', 'THIRD_PARTY_NOTICES.md']) {
  assert.ok(source.includes(`File /a "/oname=${resource}"`), `Missing bundled resource: ${resource}`);
}
const audit = JSON.parse(readFileSync('docs/license-audit.json', 'utf8'));
assert.deepEqual(audit.missing, []);
for (const archive of audit.archives) {
  assert.ok(source.includes(`File /a "/oname=licenses\\sources\\${archive.file}"`));
  const bytes = readFileSync(resolve('licenses/sources', archive.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), archive.sha256);
}
const filename = `${config.productName}_${config.version}_x64-setup.exe`;
const installer = readFileSync(resolve('target/release/bundle/nsis', filename));
assert.equal(installer.subarray(0, 2).toString(), 'MZ');
const result = {
  passed: true, filename, bytes: installer.length,
  sha256: createHash('sha256').update(installer).digest('hex'),
  licenseGroups: audit.groups, sourceArchives: audit.archives.length,
  scope: 'NSIS preprocessing, no force-kill branch, separate data directory, bundled licenses and source hashes; setup not executed',
};
mkdirSync(evidence, { recursive: true });
writeFileSync(resolve(evidence, 'installer-expanded.nsi'), expanded);
writeFileSync(resolve(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n');
process.stdout.write(`Installer inspection passed: ${filename} (${(installer.length / 1024 / 1024).toFixed(2)} MiB)\n`);
