(() => {
  const payload = JSON.stringify({
    path: location.pathname + location.search,
    title: document.title,
    referrer: document.referrer,
  });
  if (navigator.sendBeacon &&
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }))) {
    return;
  }
  fetch("/api/track", {
    method: "POST",
    body: payload,
    keepalive: true,
    headers: { "Content-Type": "application/json" },
  }).then((response) => {
    if (!response.ok) {
      throw new Error(`Page visit tracking returned HTTP ${response.status}.`);
    }
  }).catch((error) => {
    console.warn("Page visit tracking failed:", error);
  });
})();
