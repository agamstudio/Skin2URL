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

  /** @type {Map<string, QueueEntry>} */
  const queue = new Map();

  /** @type {Map<string, ResultEntry>} */
  const results = new Map();

  let uploading = false;

  /**
   * @typedef {{
   *   id: string,
   *   file: File,
   *   previewUrl: string,
   *   warn: string | null,
   * }} QueueEntry
   */

  /**
   * @typedef {{
   *   id: string,
   *   name: string,
   *   previewUrl: string,
   *   status: 'pending' | 'uploading' | 'uploaded' | 'duplicate' | 'error',
   *   url: string,
   *   error: string,
   * }} ResultEntry
   */

  const els = {
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("file-input"),
    queue: document.getElementById("queue"),
    uploadBtn: document.getElementById("upload-btn"),
    clearBtn: document.getElementById("clear-btn"),
    summary: document.getElementById("summary"),
    results: document.getElementById("results"),
    configWarning: document.getElementById("config-warning"),
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

  function updateActions() {
    const hasQueue = queue.size > 0;
    els.uploadBtn.disabled = !hasQueue || uploading || !getApiKey();
    els.clearBtn.disabled = (!hasQueue && results.size === 0) || uploading;
  }

  function setSummary(text) {
    els.summary.textContent = text || "";
  }

  /**
   * @param {File} file
   * @returns {Promise<{ warn: string | null }>}
   */
  function inspectPng(file) {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const key = `${img.naturalWidth}x${img.naturalHeight}`;
        URL.revokeObjectURL(url);
        if (!TYPICAL_SKIN_SIZES.has(key)) {
          resolve({
            warn: `Unusual size ${key} (typical: 64×64 / 64×32 / 128×128)`,
          });
        } else {
          resolve({ warn: null });
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ warn: "Could not read image dimensions" });
      };
      img.src = url;
    });
  }

  /**
   * @param {FileList | File[]} fileList
   */
  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    let skipped = 0;

    for (const file of files) {
      const isPng =
        file.type === "image/png" ||
        file.name.toLowerCase().endsWith(".png");
      if (!isPng) {
        skipped += 1;
        continue;
      }

      const { warn } = await inspectPng(file);
      const id = uid();
      queue.set(id, {
        id,
        file,
        previewUrl: URL.createObjectURL(file),
        warn,
      });
    }

    renderQueue();
    updateActions();

    if (skipped > 0) {
      setSummary(
        `Added ${files.length - skipped} file(s). Skipped ${skipped} non-PNG.`
      );
    } else if (files.length > 0) {
      setSummary(`${queue.size} file(s) ready to upload.`);
    }
  }

  function removeFromQueue(id) {
    const entry = queue.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.previewUrl);
    queue.delete(id);
    renderQueue();
    updateActions();
    setSummary(queue.size ? `${queue.size} file(s) ready to upload.` : "");
  }

  function clearAll() {
    for (const entry of queue.values()) {
      URL.revokeObjectURL(entry.previewUrl);
    }
    queue.clear();

    for (const entry of results.values()) {
      if (entry.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(entry.previewUrl);
      }
    }
    results.clear();

    renderQueue();
    renderResults();
    setSummary("");
    updateActions();
  }

  function renderQueue() {
    if (queue.size === 0) {
      els.queue.classList.add("hidden");
      els.queue.innerHTML = "";
      return;
    }

    els.queue.classList.remove("hidden");
    els.queue.innerHTML = "";

    for (const entry of queue.values()) {
      const row = document.createElement("div");
      row.className = "queue-item";
      row.innerHTML = `
        <img class="queue-thumb" alt="" />
        <div class="queue-meta">
          <div class="queue-name"></div>
          ${entry.warn ? `<div class="queue-note"></div>` : ""}
        </div>
        <button type="button" class="queue-remove" aria-label="Remove">&times;</button>
      `;
      row.querySelector("img").src = entry.previewUrl;
      row.querySelector(".queue-name").textContent = entry.file.name;
      if (entry.warn) {
        row.querySelector(".queue-note").textContent = entry.warn;
      }
      row.querySelector(".queue-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        removeFromQueue(entry.id);
      });
      els.queue.appendChild(row);
    }
  }

  function statusLabel(status) {
    switch (status) {
      case "uploaded":
        return "Uploaded";
      case "duplicate":
        return "Already uploaded";
      case "error":
        return "Error";
      case "uploading":
        return "Uploading…";
      default:
        return "Pending";
    }
  }

  function renderResults() {
    els.results.innerHTML = "";

    for (const entry of results.values()) {
      const card = document.createElement("article");
      card.className = "result-card";
      card.dataset.id = entry.id;

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

    const link = data?.data?.image?.url || data?.data?.url || data?.data?.display_url;
    if (!res.ok || !data?.success || !link) {
      const err = data?.error?.message || data?.status_txt || `Upload failed (${res.status})`;
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
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    });
    await Promise.all(runners);
  }

  async function startUpload() {
    const apiKey = getApiKey();
    if (!apiKey || queue.size === 0 || uploading) return;

    uploading = true;
    updateActions();

    const batch = Array.from(queue.values());
    queue.clear();
    renderQueue();

    /** @type {ResultEntry[]} */
    const batchResults = batch.map((entry) => ({
      id: entry.id,
      name: entry.file.name,
      previewUrl: entry.previewUrl,
      status: "pending",
      url: "",
      error: "",
      _file: entry.file,
    }));

    for (const r of batchResults) {
      results.set(r.id, r);
    }
    renderResults();

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    const concurrency = Math.max(
      1,
      Number(window.SKIN2URL_CONFIG?.maxConcurrent) || 3
    );

    /** First hash wins within this batch; later same-hash rows wait on the same promise */
    /** @type {Map<string, Promise<string>>} */
    const inFlight = new Map();

    setSummary("Uploading…");

    await mapPool(batchResults, concurrency, async (entry) => {
      entry.status = "uploading";
      renderResults();

      try {
        const buffer = await entry._file.arrayBuffer();
        const hash = await sha256Hex(buffer);

        if (sessionHashes.has(hash)) {
          entry.status = "duplicate";
          entry.url = sessionHashes.get(hash);
          skipped += 1;
          renderResults();
          return;
        }

        let uploadPromise = inFlight.get(hash);
        let isLeader = false;

        if (!uploadPromise) {
          isLeader = true;
          uploadPromise = uploadToImgbb(entry._file, apiKey)
            .then((link) => {
              sessionHashes.set(hash, link);
              return link;
            })
            .finally(() => {
              inFlight.delete(hash);
            });
          inFlight.set(hash, uploadPromise);
        }

        const link = await uploadPromise;

        if (isLeader) {
          entry.status = "uploaded";
          entry.url = link;
          uploaded += 1;
        } else {
          entry.status = "duplicate";
          entry.url = link;
          skipped += 1;
        }
      } catch (err) {
        entry.status = "error";
        entry.error = err?.message || String(err);
        failed += 1;
      } finally {
        delete entry._file;
        renderResults();
      }
    });

    uploading = false;
    updateActions();

    const parts = [];
    if (uploaded) parts.push(`Uploaded ${uploaded}`);
    if (skipped) parts.push(`skipped ${skipped} duplicates`);
    if (failed) parts.push(`${failed} failed`);
    setSummary(parts.length ? parts.join(", ") + "." : "Nothing to upload.");
  }

  function bindDropzone() {
    const dz = els.dropzone;

    dz.addEventListener("click", () => {
      if (!uploading) els.fileInput.click();
    });

    dz.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!uploading) els.fileInput.click();
      }
    });

    els.fileInput.addEventListener("change", () => {
      if (els.fileInput.files?.length) {
        addFiles(els.fileInput.files);
      }
      els.fileInput.value = "";
    });

    ["dragenter", "dragover"].forEach((type) => {
      dz.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("dragover");
      });
    });

    ["dragleave", "drop"].forEach((type) => {
      dz.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type === "dragleave") dz.classList.remove("dragover");
      });
    });

    dz.addEventListener("drop", (e) => {
      dz.classList.remove("dragover");
      if (uploading) return;
      const files = e.dataTransfer?.files;
      if (files?.length) addFiles(files);
    });
  }

  els.uploadBtn.addEventListener("click", () => startUpload());
  els.clearBtn.addEventListener("click", () => clearAll());

  bindDropzone();
  updateConfigWarning();
  updateActions();
})();
