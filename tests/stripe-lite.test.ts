import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { removeAdsPriceId, verifyStripeSignature } from '../lib/stripe-lite';

test('Stripe webhook signature verifies only inside the tolerance', () => {
  const raw = '{"id":"evt_test"}';
  const secret = 'whsec_test';
  const timestamp = 1800000000;
  const sig = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
  assert.equal(verifyStripeSignature(raw, `t=${timestamp},v1=${sig}`, secret, timestamp), true);
  assert.equal(verifyStripeSignature(raw, `t=${timestamp-1000},v1=${sig}`, secret, timestamp), false);
});

test('Remove Ads requires an explicit Stripe Price ID', () => {
  const previous = process.env.STRIPE_REMOVE_ADS_PRICE_ID;
  delete process.env.STRIPE_REMOVE_ADS_PRICE_ID;
  assert.throws(() => removeAdsPriceId(), /NOT_CONFIGURED/);
  process.env.STRIPE_REMOVE_ADS_PRICE_ID = 'price_123abc';
  assert.equal(removeAdsPriceId(), 'price_123abc');
  if (previous === undefined) delete process.env.STRIPE_REMOVE_ADS_PRICE_ID; else process.env.STRIPE_REMOVE_ADS_PRICE_ID = previous;
});
