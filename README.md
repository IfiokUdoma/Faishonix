# Faishonix

Faishonix is a browser-based sizing and outfit tool. The frontend runs on Cloudflare Workers Static Assets. The same Worker serves outfit matching, scan history and virtual try-on. D1 stores opted-in measurements and limits try-on requests.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:8787. The command sets up a local D1 database. The first build downloads and verifies the pinned MediaPipe pose model from Google Storage. The Worker serves the model and WASM from the same origin as the app. Camera capture requires localhost or HTTPS. Browser dictation depends on the browser and speech service. English search has the widest coverage. French and Spanish include selected terms.

## Check the pilot

- **Body.** Enter height, weight and body type. Capture each pose in the full-screen camera. Use Close or Escape to release the camera. Fit results come from pose landmarks, front and side silhouettes when usable, and explicitly labelled fallbacks. Measurement source labels do not represent a validated accuracy percentage.
- **Shoes.** Enter a ruler-measured length or take a top-down photo with a real A4 sheet beside the foot. Mark the endpoints of its 29.7 cm edge, then heel and longest toe. Review the estimate before saving. Use the retailer's chart for final sizing. Repeat for the other foot if needed.
- **Wardrobe.** Try `Lagos wedding`, `office blazer`, `Ankara` and `hdhdududsu`. Suggestions come from a curated library of looks and garment pairings. No catalog, paid text model or automatic outfit image generation is required.
- **History.** Opt in, complete a scan and reload. The result should appear under Your previous scans. Test isolation from a separate browser profile and use Clear saved scans to remove your entries. History belongs to a browser cookie. Clearing that cookie removes access to this history. Photos, height, weight and search text are excluded from D1 history. Scan photos stay in browser memory unless the user confirms sending them for try-on.
- **Try-on.** Requires an approved model and server-side token. Choose a garment category and confirm before the two photos are sent.

## Deploy to Cloudflare

1. Confirm the existing D1 database name and ID in `wrangler.toml` and authenticate CLI access to the owning account.
2. Set a long, randomly generated `BETA_PASSWORD` through the Worker secret settings or `npx wrangler secret put BETA_PASSWORD`. Pilot users sign in over HTTPS using username `pilot` and that password. The Worker checks it before serving either HTML or API responses. The old query-string code has no role in access. For a hosted pilot, choose a dedicated subdomain and put a Cloudflare Access policy in front of it if individual access control is needed.
3. Run `npx wrangler d1 migrations apply DB --remote` and `npm run deploy`. The new tables avoid modifying the previous `scans` table. Only migrate old personal data if its ownership and consent can be established. Disable the previous Worker routes once the replacement has been verified.
4. Run the camera and history checks on the actual HTTPS deployment. Verify a new row using `npx wrangler d1 execute DB --remote --command "SELECT item, timestamp FROM pilot_scans ORDER BY timestamp DESC LIMIT 5"`.
5. Before collecting pilot measurements, validate the estimates on consenting participants against tape and ruler measurements, and publish the pilot privacy notice and retention terms. Test mobile browsers on physical devices.

### Virtual try-on configuration

Revoke the previously exposed Replicate token. If try-on is approved, create a new token and add it using `npx wrangler secret put REPLICATE_API_TOKEN`. Keep the token out of frontend files, GitHub and chat.

The bundled IDM-VTON version is labelled non-commercial by its publisher. It remains disabled unless `ENABLE_NONCOMMERCIAL_TRY_ON=true` is explicitly set for a non-commercial evaluation. For a commercial pilot, configure a licensed Replicate model version via `TRY_ON_MODEL_VERSION`. It must accept the IDM-VTON request fields used in `worker.mjs` and return an image, or the Worker adapter must be updated and tested against that provider. `TRY_ON_DAILY_LIMIT` caps starts across the pilot and defaults to 20 UTC-day starts. A failed provider submission still consumes one start. Confirm provider image handling and spending controls before enabling try-on.

## Store integration

Load the sizing guide module from the HTTPS Faishonix deployment and mount it on a product page. The shopper opens Faishonix in a separate tab, so the store page does not receive camera data or measurements.

```html
<div id="size-guide"></div>
<script type="module">
  import {mountSizeGuide} from 'https://YOUR-FAISHONIX-DOMAIN/store-sdk.js';
  mountSizeGuide(document.querySelector('#size-guide'), {
    origin: 'https://YOUR-FAISHONIX-DOMAIN',
    mode: 'body'
  });
</script>
```

Use `shoes` for a footwear product page. For a cross-origin module import, serve the SDK with an appropriate CORS header. The Worker serves this standalone module publicly so that the storefront can load it before the shopper signs in to Faishonix.

The Shopify block in `integrations/shopify/blocks` can be copied into the `blocks/` directory of a Shopify CLI-generated theme app extension. Deploy the extension through the linked Shopify app and add the block to a product template. Enter your Faishonix URL with the optional `#shoe-scan` fragment. This integration launches sizing and does not require access to the merchant's catalog. A store installation and catalog integration require a Shopify app and development store.
