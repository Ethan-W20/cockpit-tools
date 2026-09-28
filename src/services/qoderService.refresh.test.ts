import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildQoderAccountRefreshPayload,
  buildQoderBatchRefreshPayload,
} from './qoderService.ts';

test('Qoder single-account refresh routes by account variant, never the active page variant', () => {
  const payload = buildQoderAccountRefreshPayload('qoder_uid_019c5662');
  assert.deepEqual(payload, {
    accountId: 'qoder_uid_019c5662',
    variantKey: null,
  });
  assert.equal(payload.variantKey, null);
});

test('Qoder scheduled batch refresh sends variantKey=null for all variants', () => {
  const payload = buildQoderBatchRefreshPayload(null);
  assert.deepEqual(payload, { variantKey: null });
  assert.equal(payload.variantKey, null);
});

test('Qoder null batch scope never coalesces to the default IDE', () => {
  const payload = buildQoderBatchRefreshPayload(null);
  assert.notEqual(payload.variantKey, 'qoder');
  assert.equal(payload.variantKey, null);
});

test('Qoder manual/page batch refresh sends the explicit variant key', () => {
  const payload = buildQoderBatchRefreshPayload('qoder_cn_ide');
  assert.deepEqual(payload, { variantKey: 'qoder_cn_ide' });
});

test('Qoder explicit batch variant key passes through unchanged; undefined stays on the default IDE', () => {
  assert.deepEqual(buildQoderBatchRefreshPayload('qoder'), { variantKey: 'qoder' });
  assert.deepEqual(buildQoderBatchRefreshPayload(undefined), { variantKey: 'qoder' });
});
