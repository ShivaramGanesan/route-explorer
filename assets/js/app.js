/* Route Explorer - MapLibre + OpenFreeMap, independent multi-destination routing */
(() => {
  "use strict";

  const MAX_DESTINATIONS = 5;
  const DEFAULT_CENTER = [77.5946, 12.9716]; // [longitude, latitude]
  const ROUTE_COLORS = ["#2879c7", "#e58a32", "#8b5cf6", "#159568", "#d65353"];
  const PROFILE_BY_MODE = {
    driving: "driving-car",
    cycling: "cycling-regular",
    walking: "foot-walking"
  };

  const state = {
    source: null,
    sourceName: "",
    destinations: [],
    destinationNames: [],
    routes: [],
    selectedRouteIndex: null,
    travelMode: "driving"
  };

  const $ = (id) => document.getElementById(id);
  const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/bright",
    center: DEFAULT_CENTER,
    zoom: 11,
    attributionControl: { compact: false }
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

  let mapReady = false;
  let toastTimer;
  let routeRunId = 0;
  let routeController = null;
  const markers = [];
  const routeLayerIds = [];
  const routeSourceIds = [];
  const routeHitLayerIds = [];
  const routeEventHandlers = [];
  let routePopup = null;
  let hoveredRouteIndex = null;
  let pinnedRouteIndex = null;
  const searchers = {
    source: { timer: null, controller: null, id: 0 },
    destination: { timer: null, controller: null, id: 0 }
  };

  map.on("load", () => {
    mapReady = true;
    render();
  });

  function coordinates(point) {
    return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
  }

  function showToast(message) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }

  function setRouteStatus(message, kind = "") {
    const el = $("route-status");
    el.textContent = message;
    el.className = `route-status${kind ? ` ${kind}` : ""}`;
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) return "—";
    const km = meters / 1000;
    return km < 1 ? `${Math.round(meters)} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;
    return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
  }

  function updateMapHint() {
    if (!state.source) {
      $("map-hint").textContent = "Click the map or search to set your starting point";
    } else if (state.destinations.length >= MAX_DESTINATIONS) {
      $("map-hint").textContent = "Maximum of 5 destinations added";
    } else {
      $("map-hint").textContent = "Click the map or search to add destinations";
    }
  }

  function clearMarkers() {
    while (markers.length) markers.pop().remove();
  }

  function markerElement(label, kind) {
    const element = document.createElement("div");
    element.className = "route-marker-wrap";
    const pin = document.createElement("div");
    pin.className = `custom-marker ${kind}`;
    const inner = document.createElement("span");
    inner.textContent = label;
    pin.appendChild(inner);
    element.appendChild(pin);
    return element;
  }

  function addMarker(point, label, kind, title) {
    const marker = new maplibregl.Marker({
      element: markerElement(label, kind),
      anchor: "bottom"
    })
      .setLngLat([point.lng, point.lat])
      .addTo(map);
    marker.getElement().title = title;
    markers.push(marker);
  }

  function clearRouteLayers() {
    routeEventHandlers.forEach(({ event, layer, handler }) => map.off(event, layer, handler));
    routeEventHandlers.length = 0;
    routeLayerIds.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
    });
    routeSourceIds.forEach((id) => {
      if (map.getSource(id)) map.removeSource(id);
    });
    routeLayerIds.length = 0;
    routeSourceIds.length = 0;
    routeHitLayerIds.length = 0;
    hoveredRouteIndex = null;
    pinnedRouteIndex = null;
    if (routePopup) routePopup.remove();
  }

  function routePopupContent(index) {
    const route = state.routes[index];
    const card = document.createElement("div");
    card.className = "route-hover-popup";
    const title = document.createElement("strong");
    title.textContent = state.destinationNames[index] || `Destination ${index + 1}`;
    const metrics = document.createElement("span");
    metrics.textContent = `${formatDistance(route.distance)} · ${formatDuration(route.duration)}`;
    const note = document.createElement("small");
    note.textContent = `${modeLabel()} · estimated time, no live traffic`;
    card.append(title, metrics, note);
    return card;
  }

  function showRoutePopup(index, lngLat) {
    const route = state.routes[index];
    if (!route || route.status !== "success") return;
    if (!routePopup) routePopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: "260px" });
    routePopup.setLngLat(lngLat).setDOMContent(routePopupContent(index)).addTo(map);
  }

  function setRouteEmphasis(index, active) {
    const id = `route-line-${index}`;
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, "line-width", active ? 8 : ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 6]);
    map.setPaintProperty(id, "line-opacity", active ? 1 : 0.88);
  }


  function modeLabel() {
    return state.travelMode === "driving" ? "Car" : state.travelMode === "cycling" ? "Bike" : "Walk";
  }
  function activeRouteIndex() {
    return hoveredRouteIndex !== null ? hoveredRouteIndex : state.selectedRouteIndex;
  }
  function updateRouteStyles() {
    const active = activeRouteIndex();
    state.routes.forEach((route, index) => {
      if (route && route.status === "success") setRouteEmphasis(index, index === active);
    });
  }
  function updateRouteDetails() {
    const panel = $("route-details");
    if (!panel) return;
    const index = activeRouteIndex();
    const route = index === null ? null : state.routes[index];
    const title = $("route-detail-title");
    const subtitle = $("route-detail-subtitle");
    $("route-detail-mode").textContent = modeLabel();

    if (index === null || !state.destinations[index]) {
      panel.classList.add("is-empty");
      title.textContent = "No route selected";
      subtitle.textContent = "Add a destination to see its route details.";
      $("route-detail-distance").textContent = "—";
      $("route-detail-duration").textContent = "—";
    } else {
      panel.classList.remove("is-empty");
      title.textContent = state.destinationNames[index] || `Destination ${index + 1}`;
      subtitle.textContent = `Route ${index + 1} · estimated time, no live traffic`;
      if (!route || route.status === "loading") {
        $("route-detail-distance").textContent = "Calculating…";
        $("route-detail-duration").textContent = "Calculating…";
      } else if (route.status === "success") {
        $("route-detail-distance").textContent = formatDistance(route.distance);
        $("route-detail-duration").textContent = formatDuration(route.duration);
      } else {
        $("route-detail-distance").textContent = "Unavailable";
        $("route-detail-duration").textContent = route.message || "Could not calculate";
      }
    }
    document.querySelectorAll(".destination-item").forEach((item, i) => {
      item.classList.toggle("is-selected", i === index);
      item.setAttribute("aria-pressed", String(i === index));
    });
  }
  function selectRoute(index, pin = false) {
    if (!state.destinations[index]) return;
    state.selectedRouteIndex = index;
    hoveredRouteIndex = pin ? index : null;
    if (pin) pinnedRouteIndex = index;
    updateRouteStyles();
    updateRouteDetails();
  }

  function drawRoutes() {
    if (!mapReady) return;
    clearRouteLayers();
    state.routes.forEach((route, index) => {
      if (!route || route.status !== "success" || !route.feature) return;
      const sourceId = `route-source-${index}`;
      const hitId = `route-hit-${index}`;
      const lineId = `route-line-${index}`;
      map.addSource(sourceId, { type: "geojson", data: route.feature });
      map.addLayer({
        id: hitId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ROUTE_COLORS[index], "line-width": 20, "line-opacity": 0.01 }
      });
      map.addLayer({
        id: lineId,
        type: "line",
        source: sourceId,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ROUTE_COLORS[index],
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3.5, 15, 6],
          "line-opacity": 0.88
        }
      });
      routeSourceIds.push(sourceId);
      routeLayerIds.push(hitId, lineId);
      routeHitLayerIds.push(hitId);

      const handlers = [
        ["mouseenter", (event) => {
          hoveredRouteIndex = index;
          map.getCanvas().style.cursor = "pointer";
          updateRouteStyles();
          updateRouteDetails();
          if (pinnedRouteIndex === null) showRoutePopup(index, event.lngLat);
        }],
        ["mousemove", (event) => {
          if (pinnedRouteIndex === null && hoveredRouteIndex === index) showRoutePopup(index, event.lngLat);
        }],
        ["mouseleave", () => {
          map.getCanvas().style.cursor = "";
          if (hoveredRouteIndex === index) hoveredRouteIndex = null;
          updateRouteStyles();
          updateRouteDetails();
          if (pinnedRouteIndex === null && routePopup) routePopup.remove();
        }],
        ["click", (event) => {
          selectRoute(index, true);
          showRoutePopup(index, event.lngLat);
        }]
      ];
      handlers.forEach(([eventName, handler]) => {
        map.on(eventName, hitId, handler);
        routeEventHandlers.push({ event: eventName, layer: hitId, handler });
      });
    });
  }

  function render() {
    if (mapReady) {
      clearMarkers();
      if (state.source) {
        addMarker(state.source, "S", "source", `Start: ${state.sourceName || "Pinned location"}`);
      }
      state.destinations.forEach((point, index) => {
        addMarker(point, String(index + 1), "destination", state.destinationNames[index] || `Destination ${index + 1}`);
      });
      drawRoutes();
    }

    if (state.source) {
      $("source-title").textContent = state.sourceName || "Starting point selected";
      $("source-coords").textContent = coordinates(state.source);
      $("clear-source").hidden = false;
    } else {
      $("source-title").textContent = "No starting point";
      $("source-coords").textContent = "Search above or click the map";
      $("clear-source").hidden = true;
    }

    $("destination-count").textContent = `${state.destinations.length}/${MAX_DESTINATIONS}`;
    $("mobile-count").textContent = state.destinations.length
      ? `${state.destinations.length} destination${state.destinations.length === 1 ? "" : "s"}`
      : "Plan route";

    const list = $("destination-list");
    list.innerHTML = "";
    if (state.destinations.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = '<span class="empty-icon">⌖</span><strong>No destinations yet</strong><span>Search for a place above or click the map to add one.</span>';
      list.appendChild(empty);
    } else {
      state.destinations.forEach((point, index) => {
        const route = state.routes[index];
        const item = document.createElement("div");
        item.className = "destination-item";
        item.dataset.routeIndex = String(index);
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.setAttribute("aria-label", `Focus destination ${index + 1}`);

        const number = document.createElement("span");
        number.className = "destination-number";
        number.style.background = `${ROUTE_COLORS[index]}18`;
        number.style.color = ROUTE_COLORS[index];
        number.textContent = String(index + 1);

        const info = document.createElement("span");
        info.className = "destination-info";
        const name = document.createElement("strong");
        name.textContent = state.destinationNames[index] || `Destination ${index + 1}`;
        const detail = document.createElement("small");
        detail.textContent = coordinates(point);
        const metrics = document.createElement("span");
        metrics.className = "route-metrics";
        if (!state.source) {
          metrics.textContent = "Set a starting point to route";
        } else if (!route || route.status === "loading") {
          metrics.textContent = "Calculating route…";
          metrics.classList.add("is-loading");
        } else if (route.status === "success") {
          metrics.textContent = `${formatDistance(route.distance)} · ${formatDuration(route.duration)}`;
        } else {
          metrics.textContent = route.message || "Route unavailable";
          metrics.classList.add("is-error");
        }
        info.append(name, detail, metrics);

        const remove = document.createElement("button");
        remove.className = "remove-button";
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove destination ${index + 1}`);
        remove.title = "Remove destination";
        remove.textContent = "×";

        item.append(number, info, remove);
        const focusPoint = () => map.flyTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 13), duration: 650 });
        const chooseRoute = () => {
          selectRoute(index, true);
          focusPoint();
          const route = state.routes[index];
          if (route && route.status === "success") {
            const c = route.feature.geometry.coordinates;
            const mid = c[Math.floor(c.length / 2)];
            showRoutePopup(index, { lng: mid[0], lat: mid[1] });
          }
        };
        item.addEventListener("click", (event) => {
          if (event.target.closest(".remove-button")) return;
          chooseRoute();
        });
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            chooseRoute();
          }
        });
        remove.addEventListener("click", (event) => {
          event.stopPropagation();
          state.destinations.splice(index, 1);
          state.destinationNames.splice(index, 1);
          if (state.selectedRouteIndex === index) state.selectedRouteIndex = null;
          else if (state.selectedRouteIndex !== null && state.selectedRouteIndex > index) state.selectedRouteIndex--;
          calculateRoutes();
          render();
        });
        list.appendChild(item);
      });
    }
    updateMapHint();
    updateRouteDetails();
    updateRouteStyles();
  }

  function placeDescription(feature) {
    const p = feature.properties || {};
    return [p.name, p.street, p.city || p.town || p.village, p.state, p.country]
      .filter((value, index, array) => value && array.indexOf(value) === index)
      .join(", ");
  }

  function hideSearchResults(kind) {
    const results = $(`${kind}-results`);
    results.hidden = true;
    results.innerHTML = "";
  }

  function showSearchMessage(kind, message) {
    const results = $(`${kind}-results`);
    results.innerHTML = "";
    const row = document.createElement("div");
    row.className = "search-message";
    row.textContent = message;
    results.appendChild(row);
    results.hidden = false;
  }

  function addPlaceFromSearch(feature, kind) {
    const props = feature.properties || {};
    const [lon, lat] = feature.geometry.coordinates;
    const point = { lng: lon, lat };
    const name = placeDescription(feature) || props.name || "Selected place";

    if (kind === "source") {
      state.source = point;
      state.sourceName = name;
      calculateRoutes();
      render();
      map.flyTo({ center: [point.lng, point.lat], zoom: 14, duration: 700 });
      showToast("Starting point selected.");
    } else {
      if (state.destinations.length >= MAX_DESTINATIONS) {
        showToast(`You can add up to ${MAX_DESTINATIONS} destinations.`);
        return;
      }
      state.destinations.push(point);
      state.destinationNames.push(name);
      calculateRoutes();
      render();
      map.flyTo({ center: [point.lng, point.lat], zoom: 13, duration: 700 });
      showToast(`Destination ${state.destinations.length} added.`);
    }
    $(`${kind}-search`).value = "";
    hideSearchResults(kind);
  }

  async function searchPlaces(kind, query) {
    const searcher = searchers[kind];
    const searchId = ++searcher.id;
    if (searcher.controller) searcher.controller.abort();
    searcher.controller = new AbortController();
    $(`${kind}-spinner`).classList.add("visible");
    showSearchMessage(kind, "Searching places…");

    try {
      const url = new URL("https://photon.komoot.io/api/");
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "6");
      url.searchParams.set("lang", "en");
      const response = await fetch(url, { signal: searcher.controller.signal });
      if (!response.ok) throw new Error("Search service unavailable");
      const data = await response.json();
      if (searchId !== searcher.id) return;

      const results = $(`${kind}-results`);
      results.innerHTML = "";
      if (!data.features || data.features.length === 0) {
        showSearchMessage(kind, "No matching places found. Try a more specific name or nearby city.");
        return;
      }

      data.features.forEach((feature) => {
        const props = feature.properties || {};
        const titleText = props.name || props.street || "Unnamed place";
        const detailText = [props.street && props.name !== props.street ? props.street : "", props.city || props.town || props.village, props.state, props.country]
          .filter((value, index, array) => value && array.indexOf(value) === index)
          .join(", ") || "OpenStreetMap location";
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-result";
        row.setAttribute("role", "option");
        const title = document.createElement("span");
        title.className = "search-result-title";
        title.textContent = titleText;
        const detail = document.createElement("span");
        detail.className = "search-result-detail";
        detail.textContent = detailText;
        row.append(title, detail);
        row.addEventListener("click", () => addPlaceFromSearch(feature, kind));
        results.appendChild(row);
      });
      results.hidden = false;
    } catch (error) {
      if (error.name === "AbortError") return;
      if (searchId === searcher.id) showSearchMessage(kind, "Couldn't search right now. Check your connection and try again.");
    } finally {
      if (searchId === searcher.id) $(`${kind}-spinner`).classList.remove("visible");
    }
  }

  function setupSearch(kind) {
    const input = $(`${kind}-search`);
    const searcher = searchers[kind];
    input.addEventListener("focus", () => {
      hideSearchResults(kind === "source" ? "destination" : "source");
    });
    input.addEventListener("input", () => {
      clearTimeout(searcher.timer);
      const query = input.value.trim();
      if (query.length < 3) {
        searcher.id++;
        if (searcher.controller) searcher.controller.abort();
        $(`${kind}-spinner`).classList.remove("visible");
        hideSearchResults(kind);
        return;
      }
      searcher.timer = setTimeout(() => searchPlaces(kind, query), 350);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideSearchResults(kind);
    });
  }

  async function requestRoute(destination, signal) {
    const config = window.ROUTE_EXPLORER_CONFIG || {};
    const endpoint = config.routingApiUrl;
    if (!endpoint) throw new Error("Set routingApiUrl in assets/js/config.js.");

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: PROFILE_BY_MODE[state.travelMode],
        coordinates: [
          [state.source.lng, state.source.lat],
          [destination.lng, destination.lat]
        ]
      }),
      signal
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Routing service returned ${response.status}.`);
    const feature = data.features && data.features[0];
    const summary = feature && feature.properties && feature.properties.summary;
    if (!feature || !feature.geometry || !summary) {
      throw new Error("The routing service returned an unexpected response.");
    }
    return { feature, distance: summary.distance, duration: summary.duration };
  }

  async function calculateRoutes() {
    routeRunId++;
    const thisRun = routeRunId;
    if (routeController) routeController.abort();
    routeController = null;
    state.routes = [];
    if (mapReady) clearRouteLayers();

    if (!state.source || state.destinations.length === 0) {
      if (!state.source && state.destinations.length) {
        setRouteStatus("Choose a starting point to calculate routes.");
      } else if (!state.destinations.length && state.source) {
        setRouteStatus("Add a destination to calculate a route.");
      } else {
        setRouteStatus("Add a starting point and destination to calculate a route.");
      }
      render();
      return;
    }

    routeController = new AbortController();
    const signal = routeController.signal;
    const modeLabel = state.travelMode === "driving" ? "driving" : state.travelMode === "cycling" ? "cycling" : "walking";
    state.routes = state.destinations.map(() => ({ status: "loading" }));
    if (state.selectedRouteIndex === null || state.selectedRouteIndex >= state.destinations.length) state.selectedRouteIndex = state.destinations.length ? 0 : null;
    setRouteStatus(`Calculating ${state.destinations.length} ${modeLabel} route${state.destinations.length === 1 ? "" : "s"}…`, "is-loading");
    render();

    const results = await Promise.all(state.destinations.map(async (destination) => {
      try {
        const result = await requestRoute(destination, signal);
        if (thisRun !== routeRunId) return null;
        return { status: "success", ...result };
      } catch (error) {
        if (error.name === "AbortError" || thisRun !== routeRunId) return null;
        return { status: "error", message: error.message };
      }
    }));

    if (thisRun !== routeRunId) return;
    state.routes = results.map((result) => result || { status: "error", message: "Route calculation cancelled." });
    const succeeded = state.routes.filter((route) => route.status === "success").length;
    const failed = state.routes.length - succeeded;
    if (failed === 0) {
      setRouteStatus(`${succeeded} route${succeeded === 1 ? "" : "s"} calculated · estimated times, no live traffic.`, "is-success");
    } else if (succeeded > 0) {
      setRouteStatus(`${succeeded} route${succeeded === 1 ? "" : "s"} calculated; ${failed} could not be routed.`, "is-warning");
    } else {
      const firstError = state.routes.find((route) => route.status === "error");
      setRouteStatus(firstError ? firstError.message : "Could not calculate routes.", "is-error");
    }
    render();
  }

  map.on("click", (event) => {
    if (routeHitLayerIds.length && map.queryRenderedFeatures(event.point, { layers: routeHitLayerIds }).length) return;
    if (pinnedRouteIndex !== null) {
      pinnedRouteIndex = null;
      if (routePopup) routePopup.remove();
    }
    const point = { lng: event.lngLat.lng, lat: event.lngLat.lat };
    if (!state.source) {
      state.source = point;
      state.sourceName = "Pinned starting point";
      calculateRoutes();
      render();
      showToast("Starting point set from map.");
      return;
    }
    if (state.destinations.length >= MAX_DESTINATIONS) {
      showToast(`You can add up to ${MAX_DESTINATIONS} destinations.`);
      return;
    }
    state.destinations.push(point);
    state.destinationNames.push("Pinned destination");
    calculateRoutes();
    render();
    showToast(`Destination ${state.destinations.length} added from map.`);
  });

  setupSearch("source");
  setupSearch("destination");

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-section")) {
      hideSearchResults("source");
      hideSearchResults("destination");
    }
  });

  $("clear-source").addEventListener("click", () => {
    state.source = null;
    state.sourceName = "";
    calculateRoutes();
    render();
    showToast("Starting point cleared.");
  });

  document.querySelectorAll(".mode-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.travelMode === button.dataset.mode) return;
      state.travelMode = button.dataset.mode;
      document.querySelectorAll(".mode-button").forEach((b) => {
        const active = b === button;
        b.classList.toggle("active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      calculateRoutes();
    });
  });

  $("fit-map").addEventListener("click", () => {
    const points = [];
    if (state.source) points.push(state.source);
    points.push(...state.destinations);
    if (!points.length) {
      map.easeTo({ center: DEFAULT_CENTER, zoom: 11, duration: 500 });
    } else if (points.length === 1) {
      map.flyTo({ center: [points[0].lng, points[0].lat], zoom: 13, duration: 650 });
    } else {
      const bounds = new maplibregl.LngLatBounds();
      points.forEach((point) => bounds.extend([point.lng, point.lat]));
      const isMobile = window.matchMedia("(max-width: 700px)").matches;
      map.fitBounds(bounds, {
        padding: isMobile
          ? { top: 115, right: 36, bottom: 110, left: 36 }
          : { top: 100, right: 80, bottom: 80, left: 390 },
        maxZoom: 14,
        duration: 650
      });
    }
  });

  $("reset-all").addEventListener("click", () => {
    if (routeController) routeController.abort();
    routeRunId++;
    state.source = null;
    state.sourceName = "";
    state.destinations = [];
    state.destinationNames = [];
    state.routes = [];
    state.selectedRouteIndex = null;
    $("source-search").value = "";
    $("destination-search").value = "";
    Object.values(searchers).forEach((searcher) => {
      clearTimeout(searcher.timer);
      searcher.id++;
      if (searcher.controller) searcher.controller.abort();
    });
    $("source-spinner").classList.remove("visible");
    $("destination-spinner").classList.remove("visible");
    hideSearchResults("source");
    hideSearchResults("destination");
    if (mapReady) clearRouteLayers();
    setRouteStatus("Add a starting point and destination to calculate a route.");
    render();
    map.easeTo({ center: DEFAULT_CENTER, zoom: 11, duration: 500 });
    showToast("All locations cleared.");
  });

  function setPanelCollapsed(collapsed) {
    const panel = $("side-panel");
    const expandButton = $("expand-panel");
    if (collapsed) {
      panel.classList.add("collapsed");
      panel.classList.remove("mobile-open");
      expandButton.style.display = "flex";
    } else {
      panel.classList.remove("collapsed");
      if (window.matchMedia("(max-width: 700px)").matches) panel.classList.add("mobile-open");
      else panel.classList.remove("mobile-open");
      expandButton.style.display = "none";
    }
    setTimeout(() => map.resize(), 260);
  }

  $("collapse-panel").addEventListener("click", () => setPanelCollapsed(true));
  $("expand-panel").addEventListener("click", () => setPanelCollapsed(false));

  if (window.matchMedia("(max-width: 700px)").matches) {
    $("side-panel").classList.remove("collapsed");
    $("side-panel").classList.remove("mobile-open");
  }

  window.addEventListener("resize", () => map.resize());
})();
