import assert from 'node:assert/strict';
import test from 'node:test';
import { captureMarketingAttribution, permittedMarketingQuery } from '../src/lib/marketingAttribution';
import { buildPartnerRegistrationUrl } from '../src/lib/partners';

class StorageStub {
  private value: string | null = null;
  getItem() { return this.value; }
  setItem(_key: string, value: string) { this.value = value; }
  removeItem() { this.value = null; }
}

test('partner handoff preserves only UTMs and fbclid and keeps the registration hash', () => {
  const search = '?utm_source=meta&utm_medium=cpc&utm_campaign=test&utm_content=a&utm_term=b&fbclid=XYZ&token=secret';
  const permitted = permittedMarketingQuery(search);
  assert.equal(
    buildPartnerRegistrationUrl(permitted.toString()),
    '/?utm_source=meta&utm_medium=cpc&utm_campaign=test&utm_content=a&utm_term=b&fbclid=XYZ&partner=active#register',
  );
  assert.equal(permitted.has('token'), false);
});

test('attribution is captured before redirect and restored without inventing values', () => {
  const storage = new StorageStub();
  const captured = captureMarketingAttribution(
    { search: '?utm_source=meta&utm_medium=cpc&utm_campaign=test&fbclid=XYZ', href: 'https://funpace.club/p/time?utm_source=meta' } as Location,
    { referrer: 'https://facebook.com/' } as Document,
    storage,
    () => '2026-08-04T10:00:00.000Z',
  );
  const restored = captureMarketingAttribution(
    { search: '?partner=active', href: 'https://funpace.club/?partner=active#register' } as Location,
    { referrer: '' } as Document,
    storage,
    () => '2026-08-04T10:05:00.000Z',
  );
  assert.equal(captured.fbclid, 'XYZ');
  assert.equal(restored.utmSource, 'meta');
  assert.equal(restored.utmMedium, 'cpc');
  assert.equal(restored.utmCampaign, 'test');
  assert.equal(restored.fbclid, 'XYZ');
  assert.equal(restored.term, '');
  assert.equal(restored.firstTouch?.capturedAt, '2026-08-04T10:00:00.000Z');
  assert.deepEqual(restored.lastTouch, restored.firstTouch);
});

test('new campaigns update only last touch and keep legacy fields internally consistent', () => {
  const storage = new StorageStub();
  const first = captureMarketingAttribution(
    { search: '?utm_source=meta&utm_medium=cpc&utm_campaign=first&fbclid=FIRST', href: 'https://funpace.club/?utm_campaign=first' } as Location,
    { referrer: 'https://facebook.com/' } as Document,
    storage,
    () => '2026-08-04T10:00:00.000Z',
  );
  const last = captureMarketingAttribution(
    { search: '?utm_source=google&utm_medium=search&utm_campaign=last&utm_content=ad2', href: 'https://funpace.club/?utm_campaign=last' } as Location,
    { referrer: 'https://google.com/' } as Document,
    storage,
    () => '2026-08-04T11:00:00.000Z',
  );
  assert.equal(first.firstTouch?.utmCampaign, 'first');
  assert.equal(last.firstTouch?.utmCampaign, 'first');
  assert.equal(last.lastTouch?.utmCampaign, 'last');
  assert.equal(last.utmSource, 'google');
  assert.equal(last.utmMedium, 'search');
  assert.equal(last.utmCampaign, 'last');
  assert.equal(last.campaign, 'last');
  assert.equal(last.fbclid, undefined);
});
