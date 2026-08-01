(() => {
  "use strict";

  const TYPICAL_SKIN_SIZES = new Set([
    "64x32",
    "64x64",
    "128x128",
    "256x256",
  ]);

  /** @type {Map<string, string>} hash -> ImgBB URL (session memory only) */
  const sessionHashes = new Map();

  /** @type {Map<string, ResultEntry>} */
  const results = new Map();

  /** @type {Array<{ id: string, file: File, previewUrl: string }>} */
  let pending = [];

  let processing = false;
  let dragDepth = 0;
  let hasStarted = false;

  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   previewUrl: string,
   *   status: 'uploading' | 'uploaded' | 'error',
   *   url: string,
   *   error: string,
   * }} ResultEntry
   */

  const els = {
    dropzone: document.getElementById("dropzone"),
    uploadPanel: document.getElementById("upload-panel"),
    fileInput: document.getElementById("file-input"),
    summary: document.getElementById("summary"),
    results: document.getElementById("results"),
    configWarning: document.getElementById("config-warning"),
    dragOverlay: document.getElementById("drag-overlay"),
  };

  function getApiKey() {
    const key = window.SKIN2URL_CONFIG?.imgbbApiKey?.trim() || "";
    if (!key || key === "YOUR_IMGBB_API_KEY") return "";
    return key;
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function updateConfigWarning() {
    els.configWarning.classList.toggle("hidden", Boolean(getApiKey()));
  }

  function setSummary(text) {
    els.summary.textContent = text || "";
  }

  function hideDropzone() {
    if (hasStarted) return;
    hasStarted = true;
    els.dropzone.classList.add("hidden");
    els.uploadPanel.classList.add("compact");
  }

  function statusLabel(status) {
    switch (status) {
      case "uploaded":
        return "Uploaded";
      case "error":
        return "Error";
      case "uploading":
        return "Uploading…";
      default:
        return "";
    }
  }

  function renderResults() {
    els.results.innerHTML = "";

    for (const entry of results.values()) {
      const card = document.createElement("article");
      card.className = "result-card";

      const hasUrl = Boolean(entry.url);
      card.innerHTML = `
        <div class="result-preview">
          <img alt="" />
        </div>
        <div class="result-body">
          <div class="result-name"></div>
          <div class="result-status ${entry.status}"></div>
          ${
            hasUrl
              ? `<div class="url-row">
                  <input type="text" readonly spellcheck="false" />
                  <button type="button" class="btn-copy">Copy</button>
                </div>`
              : ""
          }
          ${entry.error ? `<div class="error-msg"></div>` : ""}
        </div>
      `;

      card.querySelector(".result-preview img").src = entry.previewUrl;
      card.querySelector(".result-name").textContent = entry.name;
      card.querySelector(".result-status").textContent = statusLabel(
        entry.status
      );

      if (hasUrl) {
        const input = card.querySelector("input");
        input.value = entry.url;
        const copyBtn = card.querySelector(".btn-copy");
        copyBtn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(entry.url);
          } catch {
            input.select();
            document.execCommand("copy");
          }
          copyBtn.textContent = "Copied";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.textContent = "Copy";
            copyBtn.classList.remove("copied");
          }, 1500);
        });
      }

      if (entry.error) {
        card.querySelector(".error-msg").textContent = entry.error;
      }

      els.results.appendChild(card);
    }
  }

  /**
   * @param {ArrayBuffer} buffer
   * @returns {Promise<string>}
   */
  async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * @param {File} file
   * @param {string} apiKey
   * @returns {Promise<string>}
   */
  async function uploadToImgbb(file, apiKey) {
    const body = new FormData();
    body.append("image", file);
    body.append("name", file.name.replace(/\.png$/i, "") || "skin");

    const res = await fetch(
      `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        body,
      }
    );

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`ImgBB returned ${res.status}`);
    }

    const link =
      data?.data?.image?.url || data?.data?.url || data?.data?.display_url;
    if (!res.ok || !data?.success || !link) {
      const err =
        data?.error?.message ||
        data?.status_txt ||
        `Upload failed (${res.status})`;
      throw new Error(typeof err === "string" ? err : JSON.stringify(err));
    }

    return link;
  }

  /**
   * @template T
   * @param {T[]} items
   * @param {number} limit
   * @param {(item: T) => Promise<void>} worker
   */
  async function mapPool(items, limit, worker) {
    let index = 0;
    const runners = Array.from(
      { length: Math.min(limit, items.length) },
      async () => {
        while (index < items.length) {
          const current = items[index++];
          await worker(current);
        }
      }
    );
    await Promise.all(runners);
  }

  /**
   * @param {FileList | File[]} fileList
   */
  async function ingestFiles(fileList) {
    const apiKey = getApiKey();
    if (!apiKey) {
      updateConfigWarning();
      setSummary("Add your ImgBB API key in config.js first.");
      return;
    }

    const files = Array.from(fileList || []).filter(
      (file) =>
        file.type === "image/png" || file.name.toLowerCase().endsWith(".png")
    );

    if (files.length === 0) {
      setSummary("No PNG files found.");
      return;
    }

    hideDropzone();

    for (const file of files) {
      pending.push({
        id: uid(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    }

    processQueue();
  }

  async function processQueue() {
    if (processing) return;
    processing = true;

    const apiKey = getApiKey();
    const concurrency = Math.max(
      1,
      Number(window.SKIN2URL_CONFIG?.maxConcurrent) || 3
    );

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    while (pending.length > 0) {
      const batch = pending.splice(0, pending.length);
      setSummary("Uploading…");

      /** @type {Map<string, Promise<string>>} */
      const inFlight = new Map();

      await mapPool(batch, concurrency, async (item) => {
        let buffer;
        try {
          buffer = await item.file.arrayBuffer();
        } catch (err) {
          URL.revokeObjectURL(item.previewUrl);
          failed += 1;
          const entry = {
            id: item.id,
            name: item.file.name,
            previewUrl: "",
            status: "error",
            url: "",
            error: err?.message || String(err),
          };
          results.set(entry.id, entry);
          renderResults();
          return;
        }

        const hash = await sha256Hex(buffer);

        // Already uploaded this session — discard, no card
        if (sessionHashes.has(hash)) {
          URL.revokeObjectURL(item.previewUrl);
          skipped += 1;
          return;
        }

        let uploadPromise = inFlight.get(hash);
        let isLeader = false;

        if (!uploadPromise) {
          isLeader = true;
          uploadPromise = uploadToImgbb(item.file, apiKey)
            .then((link) => {
              sessionHashes.set(hash, link);
              return link;
            })
            .finally(() => {
              inFlight.delete(hash);
            });
          inFlight.set(hash, uploadPromise);

          const entry = {
            id: item.id,
            name: item.file.name,
            previewUrl: item.previewUrl,
            status: "uploading",
            url: "",
            error: "",
          };
          results.set(entry.id, entry);
          renderResults();

          try {
            const link = await uploadPromise;
            entry.status = "uploaded";
            entry.url = link;
            uploaded += 1;
          } catch (err) {
            entry.status = "error";
            entry.error = err?.message || String(err);
            failed += 1;
          }
          renderResults();
          return;
        }

        // Same hash already uploading in this batch — wait, then discard card
        try {
          await uploadPromise;
          skipped += 1;
        } catch {
          failed += 1;
        }
        URL.revokeObjectURL(item.previewUrl);
      });
    }

    processing = false;

    // More files may have arrived while finishing
    if (pending.length > 0) {
      processQueue();
      return;
    }

    const parts = [];
    if (uploaded) parts.push(`Uploaded ${uploaded}`);
    if (skipped) parts.push(`skipped ${skipped} duplicates`);
    if (failed) parts.push(`${failed} failed`);
    setSummary(
      parts.length ? parts.join(", ") + "." : "Nothing new to upload."
    );
  }

  function isFileDrag(e) {
    return Array.from(e.dataTransfer?.types || []).includes("Files");
  }

  function bindInteractions() {
    els.dropzone.addEventListener("click", () => {
      if (!getApiKey()) {
        updateConfigWarning();
        return;
      }
      els.fileInput.click();
    });

    els.dropzone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        els.dropzone.click();
      }
    });

    els.fileInput.addEventListener("change", () => {
      if (els.fileInput.files?.length) {
        ingestFiles(els.fileInput.files);
      }
      els.fileInput.value = "";
    });

    window.addEventListener("dragenter", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth += 1;
      els.dragOverlay.classList.add("active");
      document.body.classList.add("dragging");
    });

    window.addEventListener("dragover", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    window.addEventListener("dragleave", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        els.dragOverlay.classList.remove("active");
        document.body.classList.remove("dragging");
      }
    });

    window.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      els.dragOverlay.classList.remove("active");
      document.body.classList.remove("dragging");
      const files = e.dataTransfer?.files;
      if (files?.length) ingestFiles(files);
    });
  }

  bindInteractions();
  updateConfigWarning();
})();
