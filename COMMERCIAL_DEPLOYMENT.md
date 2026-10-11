# Parkes Rummy commercial deployment

Prepared for IBD Collective, updated 11 October 2026.

## Public model

Gameplay stays free. Ads are restricted to home, lobby, Rules & Scores, round-result and final-result surfaces. The active hand/table stays ad-free.

The Store contains permanent one-off account purchases:

| Product | Price |
|---|---:|
| Remove Ads | A$1.99 |
| Fonts Pack | A$1.99 |
| Symbols Pack | A$1.99 |
| Voice Chat | A$2.99 |
| Everything Pack | A$5.99 |

Everything includes Remove Ads, all premium fonts, all premium symbols and Voice Chat.

## Stripe live Price IDs

- Remove Ads: `price_1UOzkSFkx7dvBVlWXMfgzlEC`
- Fonts Pack: `price_1UPMOxFkx7dvBVlWPQpxb21c`
- Symbols Pack: `price_1UPMOzFkx7dvBVlWhbqWjYqy`
- Voice Chat: `price_1UPMP2Fkx7dvBVlW684l2IBD`
- Everything Pack: `price_1UPMP4Fkx7dvBVlWAWwLmICZ`

Checkout uses Stripe-hosted Checkout in one-time payment mode. Managed Payments and Adaptive Pricing are disabled for these Store sessions so the advertised AUD amount is the amount verified by the webhook.

Webhook:
`https://parkesrummy.com/api/billing/stripe/webhook`

Events:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`

## Netlify

- Team: IBD Collective (`bagdcw`)
- Site: `parkes-rummy`
- Site ID: `5c8fa8f3-c7a7-4362-944a-f0c7b9b15300`
- Production domain: `https://parkesrummy.com`
- Build command: `npm run build`
- Publish directory: `.next`
- Node: 24

Use the npm dependency layout for local CLI deployment on Windows. The pnpm symlink layout previously collided with the Netlify Next.js adapter.

Suggested deployment from the extracted release folder:

```powershell
npm.cmd install
npm.cmd run build
netlify.cmd link
netlify.cmd deploy --prod
```

A linked site only needs `netlify.cmd deploy --prod` after dependencies are installed and source changes do not modify package dependencies.

## Required Netlify environment

```text
NEXT_PUBLIC_SITE_URL=https://parkesrummy.com
BETTER_AUTH_URL=https://parkesrummy.com
DATABASE_URL=<secret>
BETTER_AUTH_SECRET=<secret>
GOOGLE_CLIENT_ID=<value>
GOOGLE_CLIENT_SECRET=<secret>
NEXT_PUBLIC_MONETIZATION_ENABLED=true
STRIPE_SECRET_KEY=<rk_live_... or sk_live_...>
STRIPE_WEBHOOK_SECRET=<whsec_...>
NEXT_PUBLIC_ADS_ENABLED=false
NEXT_PUBLIC_ADSENSE_CLIENT=ca-pub-5430752526720484
ADSENSE_PUBLISHER_ID=pub-5430752526720484
```

Optional Stripe Price env overrides exist but are not required because the production Price IDs are present as public defaults in source.

## Optional Cloudflare TURN relay

Direct WebRTC voice uses STUN without extra configuration. For relay fallback on restrictive networks, add:

```text
CLOUDFLARE_TURN_KEY_ID=<Cloudflare Realtime TURN key ID>
CLOUDFLARE_TURN_API_TOKEN=<server-only token>
```

The server requests short-lived ICE credentials after it confirms identity, voice ownership and table membership. Never expose the TURN API token in a `NEXT_PUBLIC_` value.

Legacy static TURN variables remain supported:
`VOICE_TURN_URL`, `VOICE_TURN_USERNAME`, `VOICE_TURN_CREDENTIAL`.

## AdSense

Publisher client: `ca-pub-5430752526720484`

`/ads.txt` publishes:
`google.com, pub-5430752526720484, DIRECT, f08c47fec0942fa0`

The global AdSense verification loader remains in `<head>` while `NEXT_PUBLIC_ADS_ENABLED=false`. Add the approved ad slot IDs and turn the ad switch on only after AdSense marks the site ready.

## Legal/help routes

- `/privacy`
- `/terms`
- `/cookies`
- `/data-account`
- `/about-help`
- `/store`
- `/ads.txt`
- `/robots.txt`
- `/sitemap.xml`

Support/privacy email: `dan@ibdcollective.net`.

## Database

Store and voice schema is self-provisioned on first use with safe `CREATE TABLE IF NOT EXISTS` statements. Full definitions are also included in `db/schema.sql` and `db/schema-editor.sql` for review and backups.

## Final launch checks

1. Deploy this source to the existing Netlify site.
2. Confirm one Next.js server handler is present in the Netlify deploy summary.
3. Sign in with Google on `parkesrummy.com`.
4. Create a room, join from another browser/device and perform a turn.
5. Open Store and confirm all five AUD prices.
6. Complete one controlled live purchase, confirm the entitlement appears, then issue a refund and confirm revocation.
7. Check fonts/symbols on a second device signed into the same account.
8. Test two-way voice between two devices. Repeat over mobile data before promoting voice widely.
9. Confirm home-screen/PWA backgrounding stops music and microphone access.
10. After AdSense approval, add ad slot IDs, set `NEXT_PUBLIC_ADS_ENABLED=true`, redeploy and confirm ads stay outside active play.
