import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrivacyConsentManager } from '../src/components/privacy/PrivacyConsentManager';
import {
  LEGACY_MARKETING_CONSENT_KEY,
  PRIVACY_CONSENT_STORAGE_KEY,
  PRIVACY_CONSENT_VERSION,
  createPrivacyConsentRecord,
  isConsentCategoryAllowed,
  isMarketingConsentGranted,
  readPrivacyConsent,
  writePrivacyConsent,
  type ConsentStorage,
} from '../src/lib/privacyConsent';

class MemoryStorage implements ConsentStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

test('defaults to necessary-only before a decision', () => {
  const consent = readPrivacyConsent(new MemoryStorage());
  assert.equal(consent.hasDecision, false);
  assert.deepEqual(consent.preferences, {
    necessary: true,
    statistics: false,
    marketing: false,
  });
  assert.equal(isConsentCategoryAllowed(consent, 'necessary'), true);
  assert.equal(isConsentCategoryAllowed(consent, 'statistics'), false);
  assert.equal(isConsentCategoryAllowed(consent, 'marketing'), false);
});

test('accepts all optional categories and persists a versioned decision', () => {
  const storage = new MemoryStorage();
  const now = '2026-07-28T17:00:00.000Z';
  const written = writePrivacyConsent({ statistics: true, marketing: true }, storage, now);
  const restored = readPrivacyConsent(storage);

  assert.deepEqual(restored, written);
  assert.equal(restored.hasDecision, true);
  assert.equal(restored.preferences.statistics, true);
  assert.equal(restored.preferences.marketing, true);
  const raw = JSON.parse(storage.getItem(PRIVACY_CONSENT_STORAGE_KEY) || '{}');
  assert.equal(raw.version, PRIVACY_CONSENT_VERSION);
  assert.equal(raw.decidedAt, now);
});

test('rejects optional categories and blocks statistics and marketing', () => {
  const consent = writePrivacyConsent(
    { statistics: false, marketing: false },
    new MemoryStorage(),
    '2026-07-28T17:01:00.000Z',
  );
  assert.equal(consent.hasDecision, true);
  assert.equal(isConsentCategoryAllowed(consent, 'statistics'), false);
  assert.equal(isConsentCategoryAllowed(consent, 'marketing'), false);
});

test('updates preferences while preserving the original decision timestamp', () => {
  const storage = new MemoryStorage();
  writePrivacyConsent(
    { statistics: false, marketing: false },
    storage,
    '2026-07-28T17:02:00.000Z',
  );
  const updated = writePrivacyConsent(
    { statistics: true, marketing: true },
    storage,
    '2026-07-28T17:03:00.000Z',
  );

  assert.equal(updated.decidedAt, '2026-07-28T17:02:00.000Z');
  assert.equal(updated.updatedAt, '2026-07-28T17:03:00.000Z');
  assert.equal(updated.preferences.statistics, true);
  assert.equal(updated.preferences.marketing, true);
});

test('migrates the legacy marketing choice without showing the banner again', () => {
  const storage = new MemoryStorage();
  storage.setItem(LEGACY_MARKETING_CONSENT_KEY, 'granted');
  const migrated = readPrivacyConsent(storage, '2026-07-28T17:04:00.000Z');

  assert.equal(migrated.hasDecision, true);
  assert.equal(migrated.preferences.marketing, true);
  assert.equal(migrated.preferences.statistics, false);
  assert.equal(storage.getItem(LEGACY_MARKETING_CONSENT_KEY), null);
  assert.ok(storage.getItem(PRIVACY_CONSENT_STORAGE_KEY));
});

test('invalid or outdated storage fails closed', () => {
  const storage = new MemoryStorage();
  storage.setItem(PRIVACY_CONSENT_STORAGE_KEY, JSON.stringify({
    version: 999,
    preferences: { necessary: true, statistics: true, marketing: true },
    decidedAt: 'invalid',
    updatedAt: 'invalid',
  }));
  const consent = readPrivacyConsent(storage);
  assert.equal(consent.hasDecision, false);
  assert.equal(consent.preferences.marketing, false);
});

test('marketing consent must be explicitly true', () => {
  assert.equal(isMarketingConsentGranted(true), true);
  for (const value of [false, undefined, null, 'true', 1]) {
    assert.equal(isMarketingConsentGranted(value), false);
  }
});

test('record creation always keeps necessary cookies active', () => {
  const record = createPrivacyConsentRecord(
    { statistics: false, marketing: true },
    '2026-07-28T17:05:00.000Z',
  );
  assert.equal(record.preferences.necessary, true);
});

test('Pixel, Analytics and CAPI use the centralized consent gate', () => {
  const pixel = readFileSync('src/lib/metaPixel.ts', 'utf8');
  const app = readFileSync('src/App.tsx', 'utf8');
  const serverEvents = readFileSync('server/meta-events.ts', 'utf8');
  const serverFlow = readFileSync('server/meta-registration-flow.ts', 'utf8');

  assert.match(pixel, /isConsentCategoryAllowed\(getPrivacyConsentSnapshot\(\), 'marketing'\)/);
  assert.doesNotMatch(pixel, /VITE_META_PIXEL_REQUIRE_CONSENT/);
  assert.match(app, /consent\.preferences\.statistics \? <Analytics \/> : null/);
  assert.match(serverEvents, /isMarketingConsentGranted\(metaContext\?\.marketingConsent\)/);
  assert.match(serverEvents, /isMarketingConsentGranted\(snapshot\.payload\.meta\?\.marketingConsent\)/);
  assert.match(serverEvents, /isMarketingConsentGranted\(consentSnapshot\?\.payload\.meta\?\.marketingConsent\)/);
  assert.ok(
    serverEvents.indexOf('MARKETING_CONSENT_NOT_GRANTED')
      < serverEvents.indexOf('const result = await sendMetaServerEvent(event)'),
  );
  assert.match(serverFlow, /isMarketingConsentGranted\(input\.marketingConsent\)/);
});

test('renders accessible first-choice actions without overlapping the permanent privacy control', () => {
  const markup = renderToStaticMarkup(createElement(PrivacyConsentManager));
  const manager = readFileSync('src/components/privacy/PrivacyConsentManager.tsx', 'utf8');
  assert.match(markup, /role="dialog"/);
  assert.match(markup, /Aceitar todos/);
  assert.match(markup, /Recusar opcionais/);
  assert.match(markup, /Personalizar/);
  assert.doesNotMatch(markup, /Preferências de Privacidade/);
  assert.match(manager, /consent\.hasDecision \? \(/);
  assert.match(manager, /aria-haspopup="dialog"/);
});
