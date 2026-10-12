import { grantProductFromCheckout, revokeProductForDispute, revokeProductForRefund } from '@/db/entitlements';
import { configuredPriceId, verifyStripeSignature } from '@/lib/stripe-lite';
import { STORE_PRODUCTS, type StoreProductKey } from '@/lib/store-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return new Response('Not configured', { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get('stripe-signature') || '';
  if (!verifyStripeSignature(raw, signature, secret)) return new Response('Invalid signature', { status: 400 });
  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response('Invalid payload', { status: 400 }); }
  try {
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data?.object;
      const userId = String(session?.client_reference_id || session?.metadata?.userId || '');
      const productKey = String(session?.metadata?.product || '') as StoreProductKey;
      if (Object.hasOwn(STORE_PRODUCTS, productKey)) {
        const product = STORE_PRODUCTS[productKey];
        let configuredPrice = '';
        try { configuredPrice = configuredPriceId(productKey); } catch { configuredPrice = ''; }
        const exactPurchase = session?.metadata?.priceId === configuredPrice
          && userId
          && session?.payment_status === 'paid'
          && session?.currency === 'aud'
          && Number(session?.amount_total) === product.amount;
        if (exactPurchase) {
          await grantProductFromCheckout({
            eventId: String(event.id), sessionId: String(session.id), paymentIntent: session.payment_intent ? String(session.payment_intent) : null,
            userId, productKey, amount: Number(session.amount_total), currency: String(session.currency),
          });
        }
      }
    }
    if (event.type === 'charge.refunded') {
      const charge = event.data?.object;
      if (charge?.payment_intent && Number(charge.amount_refunded) >= Number(charge.amount)) {
        await revokeProductForRefund({ eventId: String(event.id), paymentIntent: String(charge.payment_intent), fullyRefunded: true });
      }
    }
    if (event.type === 'charge.dispute.created') {
      const dispute = event.data?.object;
      const paymentIntent = dispute?.payment_intent || dispute?.charge?.payment_intent;
      if (paymentIntent) await revokeProductForDispute({ eventId: String(event.id), paymentIntent: String(paymentIntent) });
    }
    return Response.json({ received: true });
  } catch (error) {
    console.error('Parkes Rummy payment webhook failed', error instanceof Error ? error.message : 'unknown');
    return new Response('Webhook failed', { status: 500 });
  }
}
