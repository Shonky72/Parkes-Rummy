# Parkes Rummy Store release

Prepared for IBD Collective on 11 October 2026.

## Live one-off products

| Product | AUD | Stripe live Price | Permanent grants |
|---|---:|---|---|
| Remove Ads | A$1.99 | `price_1UOzkSFkx7dvBVlWXMfgzlEC` | `remove_ads` |
| Fonts Pack | A$1.99 | `price_1UPMOxFkx7dvBVlWPQpxb21c` | `premium_fonts` |
| Symbols Pack | A$1.99 | `price_1UPMOzFkx7dvBVlWhbqWjYqy` | `premium_symbols` |
| Voice Chat | A$2.99 | `price_1UPMP2Fkx7dvBVlW684l2IBD` | `voice_chat` |
| Everything Pack | A$5.99 | `price_1UPMP4Fkx7dvBVlWAWwLmICZ` | all four grants |

All purchases use Stripe-hosted Checkout in payment mode. There are no subscriptions or automatic renewals.

## Store surfaces

- `Play | Your Games | Store` tabs are inside the home `Let's play` panel.
- `/store` provides a direct Store page.
- Guests still play without an account.
- Checkout requires sign-in so ownership follows the same account across devices.
- The Everything Pack is the featured bundle and includes Remove Ads.

## Player styles

- 20 premium fonts plus the standard free name style.
- 40 premium symbols plus free initials.
- Signed-in profiles store one active font and one active symbol.
- Owned styles are copied into active room player state so other players see the selected look.
- Premium fonts are loaded from Google Fonts. The Privacy page discloses this request.

## Voice Chat

Voice is browser WebRTC audio only. There is no recording, transcription or camera access.

Controls:
- Join / Leave voice
- Mute microphone
- Silence everyone, including outgoing microphone
- Individual `Mute both ways`
- Restore individual connection only when neither side still blocks the pair
- Backgrounding or leaving stops local microphone tracks and closes peer connections

Server responsibilities:
- verify signed-in identity
- verify permanent `voice_chat` entitlement
- verify current room membership
- short-lived signalling
- voice presence
- two-way block state

Media audio flows between browser peers. For restrictive networks, the server supports Cloudflare Realtime TURN credentials when `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN` are configured. Without those values, the game uses STUN and direct WebRTC connectivity, with an optional legacy static TURN fallback.

## Database

The server creates Store and voice tables with `CREATE TABLE IF NOT EXISTS` on first Store/voice use. The complete definitions are also present in `db/schema.sql` and `db/schema-editor.sql`.

New data includes:
- permanent account entitlements
- Stripe purchase receipts and processed-event IDs
- player font/symbol profile
- short-lived voice presence and signalling
- per-room two-way voice blocks

## Stripe fulfilment

The webhook at `/api/billing/stripe/webhook` handles:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `charge.refunded`
- `charge.dispute.created`

The browser success URL never grants ownership. The webhook checks product metadata, the configured Stripe Price, AUD currency, exact advertised amount and paid status first.

A full refund or dispute removes only grants with no other paid purchase still supporting the same entitlement. For example, refunding Everything does not remove Fonts when the account also owns a separate paid Fonts Pack receipt.

## Ads

Ad positions remain limited to non-active-play surfaces. Remove Ads and Everything suppress ad placements for the account. AdSense ownership code and `ads.txt` remain present while ad slots stay controlled by `NEXT_PUBLIC_ADS_ENABLED`.

## Installed-game background behaviour

When the page is hidden, frozen or backgrounded:
- background music pauses
- queued sound effects are cleared
- the Web Audio context is suspended
- active voice stops local microphone tracks and exits voice

Returning to the foreground resumes music only when music was playing beforehand and the saved audio settings still permit playback. Voice requires another explicit Join action.

## Required production secrets

Already used by the existing deployment:
- `DATABASE_URL`
- `BETTER_AUTH_URL=https://parkesrummy.com`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

The five live Stripe Price IDs have safe public defaults in `lib/store-catalog.ts`. Matching environment variables remain supported as overrides.

Optional TURN relay:
- `CLOUDFLARE_TURN_KEY_ID`
- `CLOUDFLARE_TURN_API_TOKEN`

## Release verification performed here

- 104 TS/TSX files parsed successfully with TypeScript.
- All relative imports resolve.
- Store catalogue assertions passed for five products, exact prices, bundle grants, 21 total font choices and 41 total symbol choices.
- Restricted Stripe key support is present.
- Checkout explicitly keeps advertised prices in AUD.
- PWA background audio hooks and voice background shutdown are present.
- Cloudflare TURN credential path and two-way mute block path are present.

A full `next build` still needs to run in the Netlify/Windows environment because dependency installation is unavailable in this execution environment.
