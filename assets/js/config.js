/*
 * Route Explorer configuration.
 * Local development: keep this pointed at the local Cloudflare Worker.
 * Production: replace the URL with your deployed Worker URL.
 */
window.ROUTE_EXPLORER_CONFIG = {
  routingApiUrl: "https://route-explorer-api.route-explorer-api.workers.dev/route"
};
