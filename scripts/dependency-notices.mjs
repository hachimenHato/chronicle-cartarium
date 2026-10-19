// Generate notices from installed, lockfile-pinned packages, including build dependencies.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const entries = [];
const sections = [];
for (const [relative, item] of Object.entries(lock.packages).sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!relative) continue;
  const directory = path.join(root, relative);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && item.optional) continue;
    throw error;
  }
  const files = (await readdir(directory)).filter((name) =>
    /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name),
  );
  // busboy and streamsearch omit SPDX metadata, but ship their complete MIT LICENSE.
  let license = typeof pkg.license === 'string' ? pkg.license : item.license;
  if (!license && ['busboy', 'streamsearch'].includes(pkg.name)) {
    const text = await readFile(path.join(directory, 'LICENSE'), 'utf8');
    if (!text.includes('Permission is hereby granted, free of charge'))
      throw new Error('Unexpected MIT text');
    license = 'MIT';
  }
  if (!license) throw new Error(`Review missing license: ${relative}`);
  const notices = [];
  for (const name of files.sort()) {
    try {
      notices.push({ file: name, text: await readFile(path.join(directory, name), 'utf8') });
    } catch (error) {
      if (error.code !== 'EISDIR') throw error;
    }
  }
  if (notices.length === 0 && pkg.name === 'cookie-signature') {
    const readme = await readFile(path.join(directory, 'Readme.md'), 'utf8');
    const index = readme.indexOf('## License');
    if (index < 0) throw new Error('Missing cookie-signature license');
    notices.push({ file: 'Readme.md (License section)', text: readme.slice(index) });
  }
  if (notices.length === 0 && /^@(esbuild|rollup)\//.test(pkg.name)) {
    const parentName = pkg.name.startsWith('@esbuild/') ? 'esbuild' : 'rollup';
    const parentDirectory = path.resolve(directory, '../../', parentName);
    const parent = JSON.parse(await readFile(path.join(parentDirectory, 'package.json'), 'utf8'));
    if (parent.version !== pkg.version) throw new Error('Native binding license version mismatch');
    notices.push({
      file: `${parentName}/LICENSE.md (same-version upstream distribution)`,
      text: await readFile(path.join(parentDirectory, 'LICENSE.md'), 'utf8'),
    });
  }
  if (notices.length === 0) throw new Error(`Review missing license text: ${relative}`);
  entries.push({ name: pkg.name, version: pkg.version, license, path: relative });
  sections.push(
    `## ${pkg.name} ${pkg.version}\n\nSPDX: ${license}\n\n${notices.map((notice) => `### ${notice.file}\n\n${notice.text}`).join('\n\n')}`,
  );
}
await writeFile(
  path.join(root, 'DEPENDENCY_LICENSES.md'),
  "# Dependency licenses\n\nGenerated from package-lock.json and installed upstream LICENSE/NOTICE files. Platform-specific optional packages not installed on this host retain their licenses in their npm distributions. These terms apply to upstream components, not the project's 0BSD license.\n\n" +
    sections.join('\n\n'),
);
await writeFile(
  path.join(root, 'DEPENDENCIES.json'),
  JSON.stringify({ lockfileVersion: lock.lockfileVersion, packages: entries }, null, 2) + '\n',
);
console.log(`Dependency notices: ${entries.length} installed packages; upstream texts preserved.`);
