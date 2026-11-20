(() => {
  const container = document.querySelector(".giscus");
  const script = document.createElement("script");
  script.src = "https://giscus.app/client.js";
  script.async = true;
  script.crossOrigin = "anonymous";

  for (const attribute of container.attributes) {
    if (attribute.name.startsWith("data-") &&
        attribute.name !== "data-light-theme" && attribute.name !== "data-dark-theme") {
      script.setAttribute(attribute.name, attribute.value);
    }
  }

  let currentFrame;
  let frameReady = false;
  function syncTheme() {
    const theme = document.documentElement.classList.contains("dark")
      ? container.dataset.darkTheme
      : container.dataset.lightTheme;
    script.dataset.theme = theme;
    if (frameReady) {
      currentFrame.contentWindow?.postMessage(
        { giscus: { setConfig: { theme } } },
        "https://giscus.app",
      );
    }
  }

  new MutationObserver(syncTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  new MutationObserver(() => {
    const frame = container.querySelector("iframe.giscus-frame");
    if (frame && frame !== currentFrame) {
      currentFrame = frame;
      frameReady = false;
      frame.addEventListener("load", () => {
        frameReady = true;
        syncTheme();
      });
    }
  }).observe(container, { childList: true });

  script.addEventListener("error", () => {
    console.error("Could not load Giscus comments.");
    const message = document.createElement("p");
    message.setAttribute("role", "alert");
    message.append("Comments could not load. ");
    const link = document.createElement("a");
    link.href = `https://github.com/${container.dataset.repo}/discussions`;
    link.textContent = "View discussions on GitHub.";
    message.append(link);
    container.append(message);
  });

  syncTheme();
  container.append(script);
})();
