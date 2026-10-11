# Netlify build fix

The first manual deploy failed because `app/components/AdSlot.tsx` and `app/components/RemoveAdsOffer.tsx` imported `./monetization.css`, which resolves to `app/components/monetization.css`.

The stylesheet already exists at `app/monetization.css` and is loaded globally from `app/layout.tsx`.

Fix applied: removed the two incorrect component-level CSS imports. No empty placeholder stylesheet was added.
