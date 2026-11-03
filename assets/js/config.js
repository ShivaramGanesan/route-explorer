/*
 * Route Explorer configuration.
 * Local development: keep this pointed at the local Cloudflare Worker.
 * Production: replace the URL with your deployed Worker URL.
 */
window.ROUTE_EXPLORER_CONFIG = {
  routingApiUrl: "http://127.0.0.1:8787/route"
};
