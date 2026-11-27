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

Apply the migration under `supabase/migrations/` to the dedicated Faishonix project. For project `mnwxegdquaglauykcrty`, it has already been applied. It creates private, account-scoped scan history, vendor approvals and catalogue listings, and a `vendor-photos` bucket for public product photos. Enable email/password Auth and configure the Auth Site URL and email confirmation links for your deployment. Configure SMTP or provision confirmed pilot accounts in the Supabase dashboard for testing.

To approve a vendor, first have them create and confirm an account. From the Faishonix SQL editor, run the following after substituting their confirmed account email and brand:

```sql
insert into public.vendor_accounts (user_id, brand)
select id, 'Example Brand'
from auth.users
where email = 'vendor@example.com' and email_confirmed_at is not null;
```

The dashboard lets approved vendors publish and unpublish their own listings. Each listing includes an image, NGN price, sizes, optional size chart and tags, and an HTTPS vendor checkout or WhatsApp link. Published entries feed wardrobe search. Photos uploaded to the bucket are public product assets. Unpublishing removes a listing from search and its public image URL remains accessible.

## Vercel preview

Import the GitHub repo or open its Vercel project and add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the Preview environment. Deploy the draft PR branch. Vercel detects the build command, output directory and API rewrites from `vercel.json`.

1. In a camera-enabled browser, open the body scanner and wait for **Vision system ready**. Capture front and side views to generate an estimated size. Open the full-screen foot scanner and measure against real A4 paper or enter a ruler measurement.
2. Sign in, enable **Save future scans to my account** and complete a scan. Reload and confirm it appears. Sign in as a second user and confirm the first user's history is absent.
3. Sign in as an approved vendor, publish a tagged test listing, then search the catalogue by the garment, brand or tags. Unpublish it and search again. Confirm ordinary users cannot publish and a second vendor cannot modify the listing.

Fit estimates should be compared against tape and ruler measurements on physical devices before pilot rollout. Scan photos stay in browser memory and the history API stores only the item, estimates and creation time.

## Local virtual try-on

The pinned IDM-VTON model is licensed for non-commercial use. In a local research environment, add your Replicate token and the version below to `.env.local`. Sign in to run try-on. The local server applies a per-process daily limit and sends photos to Replicate after browser confirmation. Vercel previews and production builds keep try-on disabled.

```dotenv
TRY_ON_MODEL_VERSION=0513734a452173b8173e907e3a59d19a36266e55b48528559432bd21c7d7e985
```

## Store integration

Load the store SDK from your deployed origin and mount a sizing link with `mountSizeGuide(container, {origin, mode: 'body'})`. Use mode `shoes` for footwear. The guide opens in its own tab. The Shopify theme app block under `integrations/shopify/blocks` is a sizing link and the native vendor catalogue is available independently.
