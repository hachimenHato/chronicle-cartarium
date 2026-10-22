import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

test(
  'Windows desktop ZIP extraction refuses traversal, private paths and case collisions before writing',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-zip-extract-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const builder = path.join(root, 'fixture.ps1');
    await writeFile(
      builder,
      `param([string]$Request)\n$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\nAdd-Type -AssemblyName System.IO.Compression\n$r=Get-Content -LiteralPath $Request -Raw | ConvertFrom-Json\n$zip=[System.IO.Compression.ZipFile]::Open($r.archive,[System.IO.Compression.ZipArchiveMode]::Create)\ntry { foreach($name in $r.names) { $entry=$zip.CreateEntry($name); $writer=[System.IO.StreamWriter]::new($entry.Open()); try {$writer.Write('fixture')} finally {$writer.Dispose()} } } finally {$zip.Dispose()}\n`,
    );
    const cases = [
      ['Chronicle Cartarium-win32-x64/../../outside.txt'],
      ['Chronicle Cartarium-win32-x64/workspace/data/private.sqlite'],
      ['Chronicle Cartarium-win32-x64/.desktop/settings.json'],
      ['Chronicle Cartarium-win32-x64/resources/backend/.env'],
      ['Chronicle Cartarium-win32-x64/CON.txt'],
      ['Chronicle Cartarium-win32-x64/a.txt', 'Chronicle Cartarium-win32-x64/A.txt'],
    ];
    const extractor = path.resolve('scripts/extract-desktop-update.ps1');
    for (let index = 0; index < cases.length; index++) {
      const archive = path.join(root, `bad-${index}.zip`),
        destination = path.join(root, `bad-${index}`),
        request = path.join(root, `bad-${index}.json`);
      await writeFile(request, JSON.stringify({ archive, names: cases[index] }));
      await exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          builder,
          '-Request',
          request,
        ],
        { windowsHide: true },
      );
      await assert.rejects(
        exec(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            extractor,
            '-Archive',
            archive,
            '-Destination',
            destination,
          ],
          { windowsHide: true },
        ),
      );
      await assert.rejects(access(destination), { code: 'ENOENT' });
    }
    const archive = path.join(root, 'good.zip'),
      destination = path.join(root, 'good'),
      request = path.join(root, 'good.json');
    await writeFile(
      request,
      JSON.stringify({
        archive,
        names: [
          'Chronicle Cartarium-win32-x64/Chronicle Cartarium.exe',
          'Chronicle Cartarium-win32-x64/resources/app.asar',
        ],
      }),
    );
    await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        builder,
        '-Request',
        request,
      ],
      { windowsHide: true },
    );
    await exec(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        extractor,
        '-Archive',
        archive,
        '-Destination',
        destination,
      ],
      { windowsHide: true },
    );
    assert.equal(
      await readFile(path.join(destination, 'Chronicle Cartarium.exe'), 'utf8'),
      'fixture',
    );
    await assert.rejects(
      exec(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          extractor,
          '-Archive',
          archive,
          '-Destination',
          destination,
        ],
        { windowsHide: true },
      ),
    );
  },
);
