/*
 * mybizpulse.in — shared script for every page.
 *
 *   Pages        index.html (Home) · products.html · pricing.html · partners.html · contact.html
 *   Old links    mybizpulse.in/#pricing (from the single-page site) still work: they are sent
 *                straight to pricing.html, and the same for #products, #partners, #contact.
 *   Downloads    every edition has its own installer in /downloads/ on this server (DOWNLOAD_BASE below),
 *                served as a plain download by .htaccess; a .sha256.txt checksum sits beside each file.
 *                Pro Silver, Gold and Platinum share the Pro installer; the licence key decides the plan.
 *   Animations   the edition demos on Products & Features play on a continuous loop from the
 *                moment the page opens (no Play / Pause buttons). They pause only while the browser
 *                tab is hidden, to save the visitor's battery, and carry on when it is shown again.
 */
(() => {
  "use strict";

  /* ---------- Site configuration ---------- */

  // Installers on this website's own server (Domain India: public_html/downloads/).
  // To serve them from GitHub Releases instead, use:
  //   "https://github.com/dinlac-rgb/dinlac-rgb.github.io/releases/download/v1.0.0/"
  const DOWNLOAD_BASE = "downloads/";

  const DOWNLOADS = {
    "voice-express": DOWNLOAD_BASE + "BizPulse_Voice_Express_Setup_v1.0.0.exe",
    billing: DOWNLOAD_BASE + "BizPulse_Billing_Setup_v1.0.0.exe",
    lite: DOWNLOAD_BASE + "BizPulse_Lite_Setup_v1.0.0.exe",
    standard: DOWNLOAD_BASE + "BizPulse_Standard_Setup_v1.0.0.exe",
    pro: DOWNLOAD_BASE + "BizPulse_Setup_v1.0.0.exe"
  };

  const HOTLINES = [
    { label: "Verification line 1", number: "+91 97340 36000" },
    { label: "Verification line 2", number: "+91 97340 37000" },
    { label: "Verification line 3", number: "+91 89188 50178" }
  ];

  const CONTACT_EMAIL = "info@srijeecreations.com";

  const PAGES = {
    home: "index.html",
    products: "products.html",
    pricing: "pricing.html",
    partners: "partners.html",
    contact: "contact.html"
  };

  /* ---------- Old single-page links (#pricing …) go to the new pages ---------- */
  const hash = window.location.hash.replace(/^#/, "").toLowerCase();
  if (hash && Object.prototype.hasOwnProperty.call(PAGES, hash)) {
    const here = window.location.pathname.split("/").pop() || "index.html";
    if (here !== PAGES[hash]) {
      window.location.replace(PAGES[hash]);
      return;
    }
  }

  /* ---------- Splash (Home page only) ---------- */
  const splash = document.getElementById("splash");
  if (splash) {
    const removeSplash = () => {
      if (splash.parentNode) { splash.parentNode.removeChild(splash); }
    };
    splash.addEventListener("animationend", (event) => {
      if (event.target === splash) { removeSplash(); }
    });
    window.setTimeout(removeSplash, 3000);
  }

  /* ---------- Download buttons ---------- */
  // Each button names its edition (data-download="lite" …) and gets that edition's own installer.
  document.querySelectorAll("[data-download]").forEach((link) => {
    const url = DOWNLOADS[link.getAttribute("data-download")];
    if (url) {
      link.setAttribute("href", url);
      link.setAttribute("rel", "noopener");
    } else {
      link.removeAttribute("href");
      link.removeAttribute("download");
      link.classList.add("is-disabled");
      link.setAttribute("aria-disabled", "true");
      link.textContent = "Download · Coming Soon";
    }
  });

  /* ---------- Hotlines (Contact page) ---------- */
  const hotlineList = document.getElementById("hotline-list");
  if (hotlineList) {
    if (HOTLINES.length) {
      HOTLINES.forEach((item) => {
        const li = document.createElement("li");
        const label = document.createElement("span");
        label.className = "hl-label";
        label.textContent = item.label;
        const link = document.createElement("a");
        link.href = "tel:" + String(item.number).replace(/[^\d+]/g, "");
        link.textContent = item.number;
        li.appendChild(label);
        li.appendChild(link);
        hotlineList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.className = "hl-label";
      label.textContent = "Licence validation & support";
      const link = document.createElement("a");
      link.href = "mailto:" + CONTACT_EMAIL + "?subject=BizPulse%20licence%20validation";
      link.textContent = CONTACT_EMAIL;
      li.appendChild(label);
      li.appendChild(link);
      hotlineList.appendChild(li);
    }
  }

  /* ---------- Product animations (Products & Features page): always running ---------- */
  const timers = {};
  const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 });
  let invoiceSeq = 0;

  const matrix = document.querySelector('[data-product="pro"] .matrix');
  if (matrix) {
    for (let i = 0; i < 32; i += 1) {
      const cell = document.createElement("span");
      cell.textContent = String(Math.floor(Math.random() * 10));
      matrix.appendChild(cell);
    }
  }

  const SYNC_STEPS = ["GSTR-1 synced", "GSTR-3B synced", "TDS/TCS logged", "Income tax log updated", "Ledgers reconciled"];

  const demoHandlers = {
    pocket: { start() {}, stop() {} },
    lite: { start() {}, stop() {} },
    billing: {
      start(stage) {
        const list = stage.querySelector(".ticker");
        if (!list) { return; }
        list.textContent = "";
        const push = () => {
          invoiceSeq = (invoiceSeq % 9999) + 1;
          const taxable = 200 + Math.floor(Math.random() * 9800);
          const total = Math.round(taxable * 118) / 100;
          const li = document.createElement("li");
          const no = document.createElement("span");
          no.className = "inv-no";
          no.textContent = "SRJ/26-27/" + String(invoiceSeq).padStart(4, "0");
          const amt = document.createElement("span");
          amt.className = "inv-amt";
          amt.textContent = inr.format(total);
          li.appendChild(no);
          li.appendChild(amt);
          list.insertBefore(li, list.firstChild);
          while (list.children.length > 5) { list.removeChild(list.lastChild); }
        };
        push();
        timers.billing = window.setInterval(push, 650);
      },
      stop(stage) {
        const list = stage.querySelector(".ticker");
        if (!list) { return; }
        list.textContent = "";
        const li = document.createElement("li");
        li.className = "ticker-idle";
        li.textContent = "Invoice feed idle";
        list.appendChild(li);
      }
    },
    standard: {
      start(stage) {
        const status = stage.querySelector(".sync-status");
        if (!status) { return; }
        let i = 0;
        status.textContent = SYNC_STEPS[0];
        timers.standard = window.setInterval(() => {
          i = (i + 1) % SYNC_STEPS.length;
          status.textContent = SYNC_STEPS[i];
        }, 900);
      },
      stop(stage) {
        const status = stage.querySelector(".sync-status");
        if (status) { status.textContent = "Compliance sync idle"; }
      }
    },
    pro: {
      start(stage) {
        const cells = Array.from(stage.querySelectorAll(".matrix span"));
        if (!cells.length) { return; }
        timers.pro = window.setInterval(() => {
          cells.forEach((cell) => cell.classList.remove("is-lit"));
          for (let k = 0; k < 6; k += 1) {
            const cell = cells[Math.floor(Math.random() * cells.length)];
            cell.textContent = String(Math.floor(Math.random() * 10));
            cell.classList.add("is-lit");
          }
        }, 110);
      },
      stop(stage) {
        stage.querySelectorAll(".matrix span").forEach((cell) => cell.classList.remove("is-lit"));
      }
    }
  };

  function setDemo(card, run) {
    if (!card) { return; }
    const key = card.getAttribute("data-product");
    const stage = card.querySelector(".demo");
    const handler = demoHandlers[key];
    if (!stage || !handler) { return; }

    const running = stage.classList.contains("is-running");
    if (run === running) { return; }

    if (timers[key]) {
      window.clearInterval(timers[key]);
      timers[key] = null;
    }

    if (run) {
      stage.classList.add("is-running");
      handler.start(stage);
    } else {
      stage.classList.remove("is-running");
      handler.stop(stage);
    }
  }

  function setAllDemos(run) {
    document.querySelectorAll(".product[data-product]").forEach((card) => setDemo(card, run));
  }

  // Start every demo as soon as the page is ready, and keep them looping.
  setAllDemos(true);
  document.addEventListener("visibilitychange", () => setAllDemos(!document.hidden));

  /* ---------- Footer year ---------- */
  const yearEl = document.getElementById("year");
  if (yearEl) { yearEl.textContent = String(new Date().getFullYear()); }
})();

/* ---------- 20 Oct 2026: content protection ----------
   No right-click menu, and Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A (Cmd on a Mac) do nothing on every page.
   The site has no form fields, so nothing a visitor needs to type is affected. */
(function () {
  "use strict";
  document.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) { return; }
    var k = (e.key || "").toLowerCase();
    if (k === "c" || k === "v" || k === "x" || k === "a") { e.preventDefault(); }
  });
  ["copy", "cut", "paste", "selectstart", "dragstart"].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); });
  });
})();
