import { createHmac, timingSafeEqual } from 'node:crypto';
import { STORE_PRODUCTS, productPriceId, type StoreProductKey } from './store-catalog';

export function verifyStripeSignature(raw: string, header: string, secret: string, now = Math.floor(Date.now() / 1000)) {
  const parts = header.split(',').map(part => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300 || signatures.length === 0) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw}`, 'utf8').digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  return signatures.some(signature => {
    if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expectedBuffer.length && timingSafeEqual(candidate, expectedBuffer);
  });
}

export function removeAdsPriceId() {
  const id = process.env.STRIPE_REMOVE_ADS_PRICE_ID?.trim();
  if (!id) throw new Error('NOT_CONFIGURED');
  return id;
}

export function configuredPriceId(productKey: StoreProductKey) {
  const id = productPriceId(productKey);
  if (!id) throw new Error('NOT_CONFIGURED');
  return id;
}

export async function createStripeCheckout(input: { userId: string; email: string; origin: string; productKey: StoreProductKey }) {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key || !/^(?:sk|rk)_(?:test|live)_/.test(key)) throw new Error('NOT_CONFIGURED');
  const product = STORE_PRODUCTS[input.productKey];
  const priceId = configuredPriceId(input.productKey);
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('managed_payments[enabled]', 'false');
  // Store prices are deliberately advertised and fulfilled in AUD. Keeping
  // Adaptive Pricing off also lets the webhook verify the exact advertised
  // amount instead of accepting a converted presentment currency.
  body.set('adaptive_pricing[enabled]', 'false');
  body.set('client_reference_id', input.userId);
  body.set('customer_email', input.email);
  body.set('success_url', `${input.origin}/?store_purchase=success&product=${input.productKey}&session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${input.origin}/?store_purchase=cancelled&product=${input.productKey}`);
  body.set('metadata[userId]', input.userId);
  body.set('metadata[product]', input.productKey);
  body.set('metadata[priceId]', priceId);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price]', priceId);
  body.set('payment_intent_data[metadata][userId]', input.userId);
  body.set('payment_intent_data[metadata][product]', input.productKey);
  body.set('payment_intent_data[metadata][priceId]', priceId);
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const data = await response.json() as { id?: string; url?: string; amount_total?: number; currency?: string; error?: { message?: string } };
  if (!response.ok || !data.id || !data.url) throw new Error(data.error?.message || 'CHECKOUT_FAILED');
  if (data.amount_total !== undefined && data.amount_total !== product.amount) throw new Error('CHECKOUT_AMOUNT_MISMATCH');
  return { id: data.id, url: data.url };
}
