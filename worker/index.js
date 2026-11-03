const ORS_BASE_URL = "https://api.heigit.org/openrouteservice/v2";
const ALLOWED_PROFILES = new Set(["driving-car", "cycling-regular", "foot-walking"]);

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000")
    .split(",").map((value) => value.trim()).filter(Boolean);
  const headers = new Headers({
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  });
  if (allowed.includes("*") || allowed.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", allowed.includes("*") ? "*" : origin);
  }
  return headers;
}

function jsonResponse(data, status, headers) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000")
      .split(",").map((value) => value.trim()).filter(Boolean);

    if (origin && !allowed.includes("*") && !allowed.includes(origin)) {
      return jsonResponse({ error: "This app origin is not allowed by the routing Worker." }, 403, headers);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return jsonResponse({ ok: true, service: "route-explorer-routing" }, 200, headers);
    }

    if (url.pathname !== "/route" || request.method !== "POST") {
      return jsonResponse({ error: "Not found." }, 404, headers);
    }

    if (!env.ORS_API_KEY) {
      return jsonResponse({ error: "Routing is not configured yet. Add ORS_API_KEY to the Worker secret." }, 503, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON." }, 400, headers);
    }

    const profile = body && body.profile;
    const coordinates = body && body.coordinates;
    if (!ALLOWED_PROFILES.has(profile)) {
      return jsonResponse({ error: "Unsupported travel mode." }, 400, headers);
    }
    if (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every((point) =>
      Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) &&
      point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90
    )) {
      return jsonResponse({ error: "Provide exactly two valid [longitude, latitude] coordinates." }, 400, headers);
    }

    try {
      const upstream = await fetch(`${ORS_BASE_URL}/directions/${profile}/geojson`, {
        method: "POST",
        headers: {
          "Authorization": env.ORS_API_KEY,
          "Content-Type": "application/json",
          "Accept": "application/geo+json, application/json"
        },
        body: JSON.stringify({
          coordinates,
          instructions: false,
          geometry_simplify: true
        })
      });
      const responseText = await upstream.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { error: "The routing provider returned an unreadable response." };
      }

      if (!upstream.ok) {
        const message = responseData?.error?.message || responseData?.error ||
          `Routing provider returned ${upstream.status}.`;
        return jsonResponse({ error: String(message) }, upstream.status, headers);
      }
      return jsonResponse(responseData, 200, headers);
    } catch {
      return jsonResponse({ error: "Could not reach the routing provider. Please try again." }, 502, headers);
    }
  }
};
