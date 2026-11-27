# Faishonix

Faishonix combines browser-based fit estimates with a vendor clothing catalogue. The static frontend and API are served by Vercel. Supabase handles account sign-in, private scan history and vendor listings and photos.

## Local development

Use Node.js 24. Copy `.env.example` to `.env.local` and fill in the project URL and publishable key for the dedicated Faishonix Supabase project. Use a publishable key. The app uses each signed-in user's Supabase session and does not require an admin key.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:3000. The first build downloads and verifies a pinned MediaPipe model. The app then serves the model and WASM from its own origin.

## Supabase setup

Apply the migrations under `supabase/migrations/` to the dedicated Faishonix project. They create private scan history, vendor profiles, catalogue listings, fit requests and a `vendor-photos` bucket for public product photos. Enable email/password Auth and configure Site URL and email confirmation links for your deployment. Configure SMTP for the pilot.

After confirming their email and signing in, a vendor creates a profile from **Vendor Dashboard**. Registration is self-service. Brand names are supplied by account owners. Vendors choose a garment type and publish a photo, NGN price, sizes, optional size chart and tags, and a purchase link. Older listings can add their garment type in the dashboard. Published entries feed wardrobe and scanner searches.

A signed-in shopper can select **Request made to measure** on a listing. The form accepts reviewed camera estimates or tape measurements and requires any additional dimensions for the garment. Sending shares the measurements and account email with that vendor. Either party can see the request in **Your fit requests**. The vendor can accept or decline. Payment, price confirmation and fulfilment are arranged directly with the vendor.

## Vercel preview

Import the GitHub repo or open its Vercel project and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the Preview environment. Deploy the draft PR branch. Vercel detects the build command, output directory and API rewrites from `vercel.json`.

1. In a camera-enabled browser, open the body scanner and wait for **Vision system ready**. Capture front and side views to generate an estimated size. Open the full-screen foot scanner and measure against real A4 paper or enter a ruler measurement.
2. Sign in, enable **Save future scans to my account** and complete a scan. Reload and confirm it appears. Sign in as a second user and confirm the first user's history is absent.
3. Sign in, create a vendor profile and publish a tagged test garment. Use a second account to find it, enter measurements and send a fit request. Verify the vendor can accept it and a separate account cannot read it. Unpublish the garment and confirm it disappears from public search.

Fit estimates should be compared against tape and ruler measurements on physical devices before pilot rollout. Scan photos stay in browser memory and the history API stores only the item, estimates and creation time.

## Local virtual try-on

The pinned IDM-VTON model is licensed for non-commercial use. In a local research environment, add your Replicate token and the version below to `.env.local`. Sign in to run try-on. The local server applies a per-process daily limit and sends photos to Replicate after browser confirmation. Vercel previews and production builds keep try-on disabled.

```dotenv
TRY_ON_MODEL_VERSION=0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985
```

## Store integration

Load the store SDK from your deployed origin and mount a sizing link with `mountSizeGuide(container, {origin, mode: 'body'})`. Use mode `shoes` for footwear. The guide opens in its own tab. The Shopify theme app block under `integrations/shopify/blocks` is a sizing link and the native vendor catalogue is available independently.

### Email confirmation on Vercel

In the dedicated Supabase project's **Authentication → URL Configuration**, set the **Site URL** to the live Faishonix origin. In **Redirect URLs**, allow that origin with `/?confirmed=1` and the branch preview URL with `/?confirmed=1` if using preview signup. The signup handler explicitly sends the current origin with that path. Ensure the confirmation template uses `{{ .ConfirmationURL }}`; hardcoded localhost links and templates that always use `{{ .SiteURL }}` will ignore the per-request destination. Test with a fresh confirmation email after configuration.

Garment category photos are illustrative. The full suit, skirt, overcoat and traditional garment photos are sourced from Orjani, J.Crew, Target and Stitches Africa respectively. Published vendor photos are used for actual catalogue results.
