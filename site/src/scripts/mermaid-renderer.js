(() => {
  const dark = document.documentElement.classList.contains("dark");
  const color = (name) =>
    `rgb(${getComputedStyle(document.documentElement).getPropertyValue(name)})`;

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // HTML labels can be clipped when Mermaid measures them under browser zoom.
    htmlLabels: false,
    theme: "base",
    themeVariables: {
      primaryColor: color(dark ? "--color-primary-900" : "--color-primary-100"),
      primaryTextColor: color(dark ? "--color-neutral-100" : "--color-neutral-900"),
      primaryBorderColor: color("--color-primary-500"),
      secondaryColor: color(dark ? "--color-neutral-700" : "--color-neutral-100"),
      secondaryTextColor: color(dark ? "--color-neutral-100" : "--color-neutral-900"),
      lineColor: color(dark ? "--color-neutral-300" : "--color-neutral-600"),
      fontFamily: "system-ui, sans-serif",
    },
    flowchart: { useMaxWidth: false },
    sequence: { useMaxWidth: false },
  });

  async function renderDiagrams() {
    await mermaid.run({ querySelector: ".article-diagram .mermaid" });

    const dialog = document.createElement("dialog");
    dialog.className = "diagram-dialog";
    dialog.setAttribute("aria-labelledby", "diagram-dialog-title");
    dialog.innerHTML = `
      <div class="diagram-toolbar">
        <p id="diagram-dialog-title">Diagram: scroll to zoom, drag to pan</p>
        <button type="button" data-zoom="out" aria-label="Zoom out">-</button>
        <button type="button" data-zoom="in" aria-label="Zoom in">+</button>
        <button type="button" data-zoom="fit">Fit</button>
        <button type="button" data-close autofocus>Close</button>
      </div>
      <div class="diagram-viewport"><div class="diagram-canvas"></div></div>`;
    document.body.append(dialog);

    const viewport = dialog.querySelector(".diagram-viewport");
    const canvas = dialog.querySelector(".diagram-canvas");
    let svg;
    let scale = 1;
    let width = 1;
    let height = 1;
    let previousOverflow = "";
    let drag;

    function zoom(value) {
      scale = Math.max(0.1, Math.min(5, value));
      svg.style.width = `${width * scale}px`;
      svg.style.height = `${height * scale}px`;
    }

    function fit() {
      zoom(Math.min((viewport.clientWidth - 32) / width, (viewport.clientHeight - 32) / height, 1));
      viewport.scrollTo(0, 0);
    }

    dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      document.documentElement.style.overflow = previousOverflow;
      canvas.replaceChildren();
    });
    dialog.querySelectorAll("[data-zoom]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.zoom === "fit") fit();
        else zoom(scale * (button.dataset.zoom === "in" ? 1.25 : 0.8));
      });
    });
    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoom(scale * (event.deltaY < 0 ? 1.1 : 0.9));
    }, { passive: false });
    viewport.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      event.preventDefault();
      drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
    });
    viewport.addEventListener("pointermove", (event) => {
      if (!drag) return;
      viewport.scrollLeft = drag.left - event.clientX + drag.x;
      viewport.scrollTop = drag.top - event.clientY + drag.y;
    });
    viewport.addEventListener("lostpointercapture", () => {
      drag = null;
      viewport.classList.remove("is-panning");
    });

    document.querySelectorAll(".article-diagram").forEach((figure) => {
      const source = figure.querySelector("svg");
      if (!source) throw new Error("Mermaid did not produce an SVG diagram.");
      // Keep the rendered palette readable when the page appearance changes.
      source.style.backgroundColor = color(dark ? "--color-neutral-800" : "--color-neutral");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "diagram-expand";
      button.textContent = "Expand diagram";
      button.setAttribute("aria-haspopup", "dialog");
      button.addEventListener("click", () => {
        svg = source.cloneNode(true);
        width = source.viewBox.baseVal.width;
        height = source.viewBox.baseVal.height;
        canvas.replaceChildren(svg);
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = "hidden";
        dialog.showModal();
        fit();
      });
      figure.append(button);
    });
  }

  renderDiagrams().catch((error) => {
    console.error("Could not render article diagrams:", error); // eslint-disable-line no-console
    document.querySelectorAll(".article-diagram").forEach((figure) => {
      const message = document.createElement("p");
      message.className = "diagram-error";
      message.setAttribute("role", "alert");
      message.textContent = "A diagram could not be displayed. Reload the page to try again.";
      figure.prepend(message);
    });
  });
})();
