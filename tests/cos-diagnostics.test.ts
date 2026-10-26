import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CosPublishError, formatCosDiagnostic } from '../scripts/lib/cos-diagnostics';

test('COS diagnostics keep only a known stage, HTTP number and fixed provider code', () => {
  const error = new CosPublishError('COS_BUCKET', {
    statusCode: 403,
    error: { Code: 'AccessDenied' },
    message: 'FAKE_PRIVATE_SIGNED_URL',
    headers: { Authorization: 'FAKE_SECRET' },
  });
  assert.equal(formatCosDiagnostic(error), 'COS_BUCKET / HTTP_403 / AccessDenied');
  assert.doesNotMatch(JSON.stringify(error), /FAKE_/);
  assert.doesNotMatch(error.stack ?? '', /FAKE_/);
  assert.equal('cause' in error, false);
});

test('COS diagnostics never echo arbitrary errors, codes, statuses or SDK payloads', () => {
  for (const source of [
    { code: 'FAKE_SECRET', statusCode: '403 FAKE_SECRET' },
    { error: { Code: 'FAKE_SECRET' }, statusCode: 999 },
    new Error('FAKE_SECRET'),
  ])
    assert.equal(formatCosDiagnostic(new CosPublishError('COS_HEAD', source)), 'COS_HEAD');
  assert.equal(formatCosDiagnostic(new Error('FAKE_SECRET')), undefined);
  assert.equal(
    formatCosDiagnostic({ code: 'COS_HEAD', status: 403, providerCode: 'FAKE_SECRET' }),
    undefined,
  );
  assert.equal(formatCosDiagnostic(new CosPublishError('FAKE_SECRET')), undefined);
});

test('COS diagnostics recognize the SDK top-level code without retaining its original error', () => {
  assert.equal(
    formatCosDiagnostic(
      new CosPublishError('COS_HEAD', {
        code: 'NotFound',
        statusCode: 404,
      }),
    ),
    'COS_HEAD / HTTP_404 / NotFound',
  );
  assert.equal(formatCosDiagnostic(new CosPublishError('BUCKET_VERSIONING')), 'BUCKET_VERSIONING');
});

test('COS diagnostics distinguish fixed timeout and truncated-body codes without exposing raw SDK details', () => {
  for (const code of [
    'RequestTimeout',
    'RequestTimeOut',
    'IncompleteBody',
    'EntitySizeNotMatch',
    'InvalidDigest',
    'ETIMEDOUT',
    'ECONNRESET',
  ]) {
    const error = new CosPublishError('COS_WRITE', {
      statusCode: 400,
      error: { Code: code, Message: 'FAKE_SECRET' },
      url: 'https://not-contacted.example/?signature=FAKE_SECRET',
    });
    assert.equal(formatCosDiagnostic(error), `COS_WRITE / HTTP_400 / ${code}`);
    assert.doesNotMatch(JSON.stringify(error), /FAKE_SECRET|signature=/);
  }
});
