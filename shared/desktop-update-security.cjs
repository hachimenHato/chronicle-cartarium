const { createHash, verify } = require('node:crypto');
const path = require('node:path');
const keys = require('./release-trust.json');
const VERSION = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-(?:alpha|beta|rc)\.\d{1,9})?$/;
const SHA = /^[a-f0-9]{64}$/;
function digest(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([, item]) => item !== undefined)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([key, item]) => [key, canonical(item)]),
          )
        : v;
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
function compare(left, right) {
  const split = (text) => {
    if (!VERSION.test(text)) throw new Error('桌面版本格式无效');
    const [base, pre] = text.split('-'),
      [stage, serial] = (pre || '').split('.');
    return [
      ...base.split('.').map(Number),
      stage ? ['alpha', 'beta', 'rc'].indexOf(stage) : 3,
      Number(serial || 0),
    ];
  };
  const a = split(left),
    b = split(right);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}
function exact(value, fields) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).sort().join('|') !== fields.slice().sort().join('|')
  )
    throw new Error('桌面签名清单格式无效');
}
function verifyDesktopManifest(signed, currentVersion, trust = keys, allowSame = false) {
  exact(signed, ['manifest', 'signature']);
  const m = signed.manifest;
  exact(m, [
    'format',
    'formatVersion',
    'version',
    'minimumShellVersion',
    'platform',
    'architecture',
    'keyId',
    'archive',
    'treeSha256',
    'entrypoints',
  ]);
  exact(m.archive, ['name', 'bytes', 'sha256']);
  exact(m.entrypoints, [
    'Chronicle Cartarium.exe',
    'resources/app.asar',
    'resources/backend/runtime/node.exe',
  ]);
  if (
    m.format !== 'chronicle-cartarium-desktop-update' ||
    m.formatVersion !== 1 ||
    m.platform !== 'win32' ||
    m.architecture !== 'x64' ||
    !VERSION.test(m.version) ||
    !VERSION.test(m.minimumShellVersion) ||
    !/^[a-f0-9]{16}$/.test(m.keyId) ||
    !SHA.test(m.treeSha256) ||
    !Object.values(m.entrypoints).every((v) => typeof v === 'string' && SHA.test(v)) ||
    m.archive.name !== `chronicle-cartarium-${m.version}-windows-desktop-x64.zip` ||
    !Number.isSafeInteger(m.archive.bytes) ||
    m.archive.bytes <= 0 ||
    m.archive.bytes > 512 * 1024 ** 2 ||
    !SHA.test(m.archive.sha256) ||
    typeof signed.signature !== 'string' ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signed.signature)
  )
    throw new Error('桌面更新不兼容或清单无效');
  if (
    !trust[m.keyId] ||
    !verify(null, Buffer.from(digest(m)), trust[m.keyId], Buffer.from(signed.signature, 'base64'))
  )
    throw new Error('桌面更新官方签名校验失败');
  if (
    currentVersion &&
    (compare(m.version, currentVersion) < (allowSame ? 0 : 1) ||
      compare(currentVersion, m.minimumShellVersion) < 0)
  )
    throw new Error('桌面版本不满足升级条件');
  return m;
}
function releaseDirectory(base, releaseId) {
  if (typeof releaseId !== 'string' || !/^shell-[a-f0-9-]{36}$/.test(releaseId))
    throw new Error('桌面更新路径无效');
  return path.join(path.resolve(base), '.desktop', 'releases', releaseId);
}
module.exports = { digest, compare, verifyDesktopManifest, releaseDirectory };
