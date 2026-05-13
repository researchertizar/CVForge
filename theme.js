/* ═══════════════════════════════════════
   CVForge Pro — Theme Controller
   Handles dark/light toggle + persistence.
   Runs before DOMContentLoaded to prevent FOUC.
   ═══════════════════════════════════════ */

(function () {
  "use strict";

  var STORAGE_KEY = "cvforge_theme";

  /* ── Apply theme instantly (before paint) ── */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    /* Update meta theme-color for mobile chrome */
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.content = theme === "light" ? "#f5f5f0" : "#07080f";
    }
  }

  /* ── Detect initial theme ── */
  function getInitialTheme() {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
    /* Fall back to OS preference */
    if (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches
    ) {
      return "light";
    }
    return "light"; /* Default to light if no preference */
  }

  var currentTheme = getInitialTheme();
  applyTheme(currentTheme);

  /* ── Wire toggle button after DOM ready ── */
  function wireToggle() {
    var btn = document.getElementById("themeToggle");
    if (!btn) return;

    btn.setAttribute(
      "aria-label",
      currentTheme === "light" ? "Switch to dark mode" : "Switch to light mode",
    );
    btn.setAttribute(
      "title",
      currentTheme === "light" ? "Switch to dark mode" : "Switch to light mode",
    );

    btn.addEventListener("click", function () {
      currentTheme = currentTheme === "dark" ? "light" : "dark";
      applyTheme(currentTheme);
      localStorage.setItem(STORAGE_KEY, currentTheme);
      btn.setAttribute(
        "aria-label",
        currentTheme === "light"
          ? "Switch to dark mode"
          : "Switch to light mode",
      );
      btn.setAttribute(
        "title",
        currentTheme === "light"
          ? "Switch to dark mode"
          : "Switch to light mode",
      );
    });

    /* Also listen to OS changes mid-session */
    if (window.matchMedia) {
      window
        .matchMedia("(prefers-color-scheme: light)")
        .addEventListener("change", function (e) {
          /* Only auto-change if user hasn't manually picked */
          if (!localStorage.getItem(STORAGE_KEY)) {
            currentTheme = e.matches ? "light" : "dark";
            applyTheme(currentTheme);
          }
        });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireToggle);
  } else {
    wireToggle();
  }

  /* ── Generate inline SVG icons for PWA manifest ──
     Fixes 404 on icon-192.png / icon-512.png by
     generating them at runtime as canvas data URLs
     and patching the manifest dynamically.          */
  function patchPWAIcons() {
    if (typeof document === "undefined") return;

    function makeIconDataUrl(size) {
      try {
        var canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext("2d");
        if (!ctx) return null;

        /* Rounded rect background */
        var r = size * 0.18;
        ctx.beginPath();
        ctx.moveTo(r, 0);
        ctx.lineTo(size - r, 0);
        ctx.quadraticCurveTo(size, 0, size, r);
        ctx.lineTo(size, size - r);
        ctx.quadraticCurveTo(size, size, size - r, size);
        ctx.lineTo(r, size);
        ctx.quadraticCurveTo(0, size, 0, size - r);
        ctx.lineTo(0, r);
        ctx.quadraticCurveTo(0, 0, r, 0);
        ctx.closePath();

        /* Gradient fill */
        var grad = ctx.createLinearGradient(0, 0, size, size);
        grad.addColorStop(0, "#4f8ef7");
        grad.addColorStop(1, "#5fa8ff");
        ctx.fillStyle = grad;
        ctx.fill();

        /* "CV" text */
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold " + Math.round(size * 0.38) + "px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("CV", size / 2, size / 2 + size * 0.03);

        return canvas.toDataURL("image/png");
      } catch (e) {
        return null;
      }
    }

    /* Only patch if icons are missing (check via fetch HEAD) */
    function tryPatch() {
      var icon192 = makeIconDataUrl(192);
      var icon512 = makeIconDataUrl(512);
      if (!icon192 || !icon512) return;

      /* Inject as object URLs on the window for SW / manifest reference */
      window._cvforgeIcon192 = icon192;
      window._cvforgeIcon512 = icon512;

      /* Patch apple-touch-icon link */
      var appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
      if (appleIcon) appleIcon.href = icon192;

      /* Create a new manifest blob with data-URL icons */
      var manifestLink = document.querySelector('link[rel="manifest"]');
      if (!manifestLink) return;

      fetch(manifestLink.href)
        .then(function (r) {
          return r.json();
        })
        .then(function (manifest) {
          manifest.icons = [
            {
              src: icon192,
              sizes: "192x192",
              type: "image/png",
              purpose: "any maskable",
            },
            {
              src: icon512,
              sizes: "512x512",
              type: "image/png",
              purpose: "any",
            },
          ];
          var blob = new Blob([JSON.stringify(manifest)], {
            type: "application/json",
          });
          var url = URL.createObjectURL(blob);
          manifestLink.href = url;
        })
        .catch(function () {
          /* manifest fetch failed, skip */
        });
    }

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", tryPatch);
    } else {
      tryPatch();
    }
  }

  patchPWAIcons();
})();
