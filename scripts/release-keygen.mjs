import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
const filename = path.resolve(
  process.env.RELEASE_SIGNING_KEY || '.runtime/release-signing-private.pem',
);
const trustSource = await readFile('shared/release-trust.ts', 'utf8');
let trusted;
try {
  trusted = JSON.parse(await readFile('shared/release-trust.json', 'utf8'));
} catch {
  throw new Error('发行信任文件缺失或损坏，禁止自动生成替代密钥。请恢复原信任文件。');
}
if (!trusted || typeof trusted !== 'object' || Array.isArray(trusted))
  throw new Error('发行信任格式无效。');
const alreadyTrusted = Object.keys(trusted).length > 0 || /[a-f0-9]{16}['"]?\s*:/.test(trustSource);
await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
let privateKey;
if (
  await access(filename).then(
    () => true,
    () => false,
  )
)
  privateKey = await readFile(filename, 'utf8');
else {
  if (alreadyTrusted) throw new Error('发布签名私钥缺失，禁止自动生成替代密钥。请恢复原私钥。');
  privateKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  await writeFile(filename, privateKey, { flag: 'wx', mode: 0o600 });
}
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
const id = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
if (alreadyTrusted && trusted[id] !== publicKey)
  throw new Error('签名私钥不匹配，现有信任公钥未改变。');
if (!alreadyTrusted)
  await writeFile('shared/release-trust.json', JSON.stringify({ [id]: publicKey }, null, 2) + '\n');
console.log('发布验证公钥已配置。请独立安全备份签名私钥；未输出私钥内容。');
