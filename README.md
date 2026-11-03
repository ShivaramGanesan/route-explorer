# Route Explorer

A lightweight, responsive multi-destination route planner built with vanilla HTML, CSS and JavaScript.

## What this version includes

- Full-screen MapLibre map using the OpenFreeMap Bright vector style (OpenStreetMap data)
- Separate search fields for the starting point and destinations
- Photon autocomplete for cities, addresses and landmarks
- Selecting a suggestion in the start field sets/replaces the origin
- Selecting a suggestion in the destination field adds a destination
- Map clicks set the first point as the origin; later clicks add destinations
- Up to five destinations, each routed independently from the origin
- Driving, cycling and walking routes using openrouteservice
- Distance and estimated duration shown for each destination
- Route recalculation when the origin, destinations or travel mode changes
- Desktop collapsible panel and mobile bottom-sheet panel
- No login, database, or persistent storage; refresh clears the session

## How routing is connected

The browser calls a small Cloudflare Worker. The Worker calls the HeiGIT openrouteservice API and keeps the API key secret-side. The frontend does not contain the key.

Current API endpoint used by the Worker:

`https://api.heigit.org/openrouteservice/v2/directions/{profile}/geojson`

Profiles:

- Car: `driving-car`
- Bike: `cycling-regular`
- Walk: `foot-walking`

Each destination is a separate two-coordinate directions request from the source. Destinations are not chained together. Route durations are estimates from the routing profile and do not include live traffic.

## Prerequisites

- Python 3 (to serve the static frontend locally)
- Node.js/npm (to run the Cloudflare Worker with Wrangler)
- A free openrouteservice/HeiGIT account and API key: https://account.heigit.org/

The public Standard plan currently lists 2,000 Directions requests per day and 40 per minute. Each destination route uses one request; changing travel mode recalculates the routes. Check current quotas before relying on them for public use: https://openrouteservice.org/plans/ .

## Run locally

### 1. Configure the routing API key

From the project root, copy the example secrets file:

```bash
cp .dev.vars.example .dev.vars
```

Open `.dev.vars` and replace the placeholder with your own key:

```text
ORS_API_KEY=your_actual_key_here
```

Do not commit `.dev.vars` to GitHub or share it. It is ignored by the project `.gitignore`.

### 2. Start the Cloudflare Worker

Open Terminal in the project root and run:

```bash
npx wrangler dev --port 8787
```

The Worker should be available at `http://127.0.0.1:8787`. You can check `http://127.0.0.1:8787/health` in a browser.

### 3. Start the frontend

Open a second Terminal in the project root and run:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000.

The frontend's local Worker URL is configured in `assets/js/config.js`:

```js
window.ROUTE_EXPLORER_CONFIG = {
  routingApiUrl: "http://127.0.0.1:8787/route"
};
```

## Deploying to Cloudflare Pages + Workers

The frontend and routing proxy are deployed separately:

- **Cloudflare Pages** hosts the static HTML, CSS and JavaScript.
- **One Cloudflare Worker** receives route requests and holds the single routing API key.

You do not need an API key for Photon search or the OpenStreetMap tiles used by this starter. The only secret in this version is `ORS_API_KEY` for HeiGIT routing.

### A. Deploy the routing Worker (once)

1. From the project root, run `npx wrangler login` and complete the browser sign-in.
2. In `wrangler.toml`, set `ALLOWED_ORIGINS` to include your Pages URL, for example:

   ```toml
   ALLOWED_ORIGINS = "https://your-project.pages.dev"
   ```

   You can include your local origins too, separated by commas.
3. Deploy the Worker:

   ```bash
   npx wrangler deploy
   ```

4. Add the API key as an encrypted Worker secret:

   ```bash
   npx wrangler secret put ORS_API_KEY
   ```

   Paste the HeiGIT key when prompted. Cloudflare stores it as a secret; it is not bundled with your website code. You can alternatively add it in **Cloudflare Dashboard → Workers & Pages → route-explorer-api → Settings → Variables and Secrets → Add → Secret**, then deploy the change.
5. Your Worker URL will look like `https://route-explorer-api.<your-subdomain>.workers.dev`.

### B. Connect the Pages frontend to the Worker

1. Open `assets/js/config.js`.
2. Replace the local URL with your deployed Worker endpoint:

   ```js
   window.ROUTE_EXPLORER_CONFIG = {
     routingApiUrl: "https://route-explorer-api.<your-subdomain>.workers.dev/route"
   };
   ```
3. Push the project to GitHub and connect that repository to Cloudflare Pages. Use no build command and set the output directory to `/` (the repository root).
4. Every Pages deployment will now call the same Worker. You do not add the ORS key to Pages because the separate Worker already owns it.

If you prefer the dashboard for the secret, Cloudflare's current instructions are documented at https://developers.cloudflare.com/workers/configuration/secrets/ . The `wrangler secret put` command is documented at https://developers.cloudflare.com/workers/wrangler/commands/workers/ .

The Worker origin allowlist is a browser CORS control, not full authentication. Before making a public app, configure Cloudflare rate limiting or another abuse-control measure for `/route` so others cannot consume your API quota.

## Important notes

- Photon search uses the public Photon service and requires an internet connection. Respect its fair-use limits.
- The map uses MapLibre GL JS with OpenFreeMap Bright vector tiles. OpenFreeMap currently advertises its public instance as free to use without registration or API keys; attribution is displayed by MapLibre. Check its terms and service status before a high-traffic launch: https://openfreemap.org/
- OpenFreeMap is a separate public vector-tile service based on OpenStreetMap data; it is not operated by the OpenStreetMap Foundation. Review its current terms before high-volume use.
- The openrouteservice Standard plan has daily and per-minute quotas; a route is requested separately for every destination.
- Routes and travel durations are based on map/network data, not live traffic.
- Initial map view is Bengaluru; this is only a default viewport and does not represent the user's current location.
- Locations are not saved. Refreshing the page clears the current session.


## v3.4 — Selected route details

Select a destination or route to show its destination name, travel mode, distance, and estimated duration in a persistent details panel. The selected route is highlighted. Hovering another route previews its details, then returns to the selected route. Estimates are profile-based and do not include live traffic.
