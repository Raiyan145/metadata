'use strict';

/**
 * ============================================================================
 * Stock Metadata AI — script.js
 * ----------------------------------------------------------------------------
 * Vanilla JS, no build step, no framework. Organized top-to-bottom as:
 *   1. Config & constants
 *   2. State
 *   3. DOM references
 *   4. Icons
 *   5. Utilities
 *   6. Theme
 *   7. Scroll reveal / mobile menu / FAQ / ripple (small UI interactions)
 *   8. Upload & validation
 *   9. Image resizing (client-side, before it ever reaches the server)
 *   10. Preview strip rendering
 *   11. Analysis orchestration (calls /api/analyze once per image)
 *   12. Results dashboard rendering
 *   13. Copy to clipboard
 *   14. Export (TXT / CSV / JSON)
 *   15. Toast notifications
 *   16. Event wiring & init
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// 1. Config & constants
// ----------------------------------------------------------------------------
const MAX_IMAGES = 10;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SOURCE_FILE_SIZE = 25 * 1024 * 1024; // 25MB, before client-side resizing
const RESIZE_MAX_DIMENSION = 1568;
const RESIZE_JPEG_QUALITY = 0.85;
const TOAST_LIFETIME_MS = 3200;

// ----------------------------------------------------------------------------
// 2. State
// ----------------------------------------------------------------------------
const state = {
  images: [], // { id, file, fileName, fileSize, dataUrl, base64, mimeType, status, result, error }
  isProcessing: false,
  openCardIds: new Set(),
};

// ----------------------------------------------------------------------------
// 3. DOM references
// ----------------------------------------------------------------------------
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const uploadError = document.getElementById('upload-error');
const previewWrap = document.getElementById('preview-wrap');
const previewStrip = document.getElementById('preview-strip');
const previewCount = document.getElementById('preview-count');
const btnClearAll = document.getElementById('btn-clear-all');
const btnAnalyze = document.getElementById('btn-analyze');
const btnAnalyzeIcon = document.getElementById('btn-analyze-icon');
const btnAnalyzeLabel = document.getElementById('btn-analyze-label');

const dashboardSection = document.getElementById('dashboard');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressText = document.getElementById('progress-text');
const progressFraction = document.getElementById('progress-fraction');
const resultsList = document.getElementById('results-list');
const exportAllBar = document.getElementById('export-all-bar');
const btnExportAllTxt = document.getElementById('btn-export-all-txt');
const btnExportAllCsv = document.getElementById('btn-export-all-csv');
const btnExportAllJson = document.getElementById('btn-export-all-json');

const themeToggleBtn = document.getElementById('theme-toggle');
const themeIconSun = document.getElementById('theme-icon-sun');
const themeIconMoon = document.getElementById('theme-icon-moon');

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');

const toastContainer = document.getElementById('toast-container');
const footerYear = document.getElementById('footer-year');

// ----------------------------------------------------------------------------
// 4. Icons (small inline SVGs used in dynamically generated markup)
// ----------------------------------------------------------------------------
const ICONS = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13m0 0-4-4m4 4 4-4M5 19h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7M21 4v5h-5"/></svg>',
};

// ----------------------------------------------------------------------------
// 5. Utilities
// ----------------------------------------------------------------------------
function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
}

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateName(name, max = 32) {
  return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getEntryById(id) {
  return state.images.find((img) => img.id === id);
}

function smoothScrollTo(sectionId) {
  const target = document.getElementById(sectionId);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ----------------------------------------------------------------------------
// 6. Theme (dark / light)
// ----------------------------------------------------------------------------
function applyTheme(isDark) {
  document.documentElement.classList.toggle('dark', isDark);
  themeIconSun.classList.toggle('hidden', isDark);
  themeIconMoon.classList.toggle('hidden', !isDark);
  try {
    localStorage.setItem('smai-theme', isDark ? 'dark' : 'light');
  } catch (err) {
    /* localStorage unavailable — theme just won't persist across visits */
  }
}

function initTheme() {
  // The inline script in <head> already set the correct class before paint;
  // this just syncs the toggle icon to match.
  const isDark = document.documentElement.classList.contains('dark');
  themeIconSun.classList.toggle('hidden', isDark);
  themeIconMoon.classList.toggle('hidden', !isDark);
}

function toggleTheme() {
  applyTheme(!document.documentElement.classList.contains('dark'));
}

// ----------------------------------------------------------------------------
// 7. Small UI interactions
// ----------------------------------------------------------------------------
function initScrollReveal() {
  const items = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window) || !items.length) {
    items.forEach((el) => el.classList.add('revealed'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
  );
  items.forEach((el) => observer.observe(el));
}

function toggleMobileMenu(forceState) {
  const isOpen = mobileMenu.classList.contains('is-open');
  const next = forceState !== undefined ? forceState : !isOpen;
  mobileMenu.classList.toggle('is-open', next);
  mobileMenuBtn.setAttribute('aria-expanded', String(next));
}

function toggleFaqItem(button) {
  const panel = document.getElementById(button.getAttribute('aria-controls'));
  if (!panel) return;
  const isOpen = button.getAttribute('aria-expanded') === 'true';
  button.setAttribute('aria-expanded', String(!isOpen));
  panel.classList.toggle('is-open', !isOpen);
}

function addRipple(button, event) {
  const rect = button.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = `${size}px`;
  const x = (event.clientX || rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (event.clientY || rect.top + rect.height / 2) - rect.top - size / 2;
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  button.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

// ----------------------------------------------------------------------------
// 8. Upload & validation
// ----------------------------------------------------------------------------
function showUploadError(message) {
  uploadError.textContent = message;
  uploadError.classList.remove('hidden');
}

function clearUploadError() {
  uploadError.textContent = '';
  uploadError.classList.add('hidden');
}

function setDropzoneBusy(isBusy) {
  dropzone.setAttribute('aria-busy', String(isBusy));
  dropzone.style.opacity = isBusy ? '0.65' : '';
  dropzone.style.pointerEvents = isBusy ? 'none' : '';
}

function validateFiles(files, remainingSlots) {
  const rejected = [];
  const accepted = [];

  for (const file of files) {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      rejected.push(`${truncateName(file.name)} — unsupported format`);
      continue;
    }
    if (file.size > MAX_SOURCE_FILE_SIZE) {
      rejected.push(`${truncateName(file.name)} — over 25MB`);
      continue;
    }
    const isDuplicate = state.images.some(
      (img) => img.fileName === file.name && img.fileSize === file.size
    );
    if (isDuplicate) {
      rejected.push(`${truncateName(file.name)} — already added`);
      continue;
    }
    accepted.push(file);
  }

  const toAdd = accepted.slice(0, remainingSlots);
  if (accepted.length > toAdd.length) {
    rejected.push(`${accepted.length - toAdd.length} image(s) skipped — ${MAX_IMAGES}-image limit reached`);
  }

  return { toAdd, rejected };
}

async function handleFiles(fileList) {
  clearUploadError();
  const incoming = Array.from(fileList || []);
  if (!incoming.length) return;

  const remainingSlots = MAX_IMAGES - state.images.length;
  if (remainingSlots <= 0) {
    showUploadError(`You've already loaded the maximum of ${MAX_IMAGES} images.`);
    return;
  }

  const { toAdd, rejected } = validateFiles(incoming, remainingSlots);
  if (rejected.length) showUploadError(rejected.join(' · '));
  if (!toAdd.length) return;

  setDropzoneBusy(true);

  for (const file of toAdd) {
    const entry = {
      id: generateId(),
      file,
      fileName: file.name,
      fileSize: file.size,
      dataUrl: null,
      base64: null,
      mimeType: 'image/jpeg', // canvas re-encodes every source format to JPEG
      status: 'pending',
      error: null,
      result: null,
    };
    state.images.push(entry);
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      entry.dataUrl = dataUrl;
      entry.base64 = dataUrl.split(',')[1];
    } catch (err) {
      entry.status = 'error';
      entry.error = 'Could not read this image file.';
    }
  }

  setDropzoneBusy(false);
  renderPreviewStrip();
  updateAnalyzeButtonState();
}

function initDropzone() {
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evtName) => {
    dropzone.addEventListener(evtName, (event) => {
      event.preventDefault();
      dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach((evtName) => {
    dropzone.addEventListener(evtName, (event) => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
    });
  });
  dropzone.addEventListener('drop', (event) => {
    const files = event.dataTransfer && event.dataTransfer.files;
    if (files && files.length) handleFiles(files);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) handleFiles(fileInput.files);
    fileInput.value = ''; // allow re-selecting the same file later
  });
}

function removeImage(id) {
  state.images = state.images.filter((img) => img.id !== id);
  state.openCardIds.delete(id);
  renderPreviewStrip();
  updateAnalyzeButtonState();
  if (dashboardSection && !dashboardSection.classList.contains('hidden')) {
    renderResultsList();
    updateProgress();
  }
}

function clearAll() {
  state.images = [];
  state.openCardIds.clear();
  renderPreviewStrip();
  updateAnalyzeButtonState();
  clearUploadError();
}

// ----------------------------------------------------------------------------
// 9. Image resizing (client-side, before anything is sent to the server)
// ----------------------------------------------------------------------------
function resizeImageToDataUrl(file, maxDimension = RESIZE_MAX_DIMENSION, quality = RESIZE_JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file.'));
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onerror = () => reject(new Error('Could not decode image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        // Flatten transparency onto white before JPEG re-encoding — JPEG has
        // no alpha channel, and an unfilled canvas would otherwise composite
        // transparent pixels as black.
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = readerEvent.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ----------------------------------------------------------------------------
// 10. Preview strip rendering
// ----------------------------------------------------------------------------
function renderPreviewStrip() {
  const hasImages = state.images.length > 0;
  previewWrap.classList.toggle('hidden', !hasImages);
  previewCount.textContent = `${state.images.length} of ${MAX_IMAGES} frames loaded`;

  previewStrip.innerHTML = state.images
    .map((entry, index) => {
      const frameLabel = `F${String(index + 1).padStart(2, '0')}`;
      const thumb = entry.dataUrl
        ? `<img src="${entry.dataUrl}" alt="Preview of ${escapeHtml(entry.fileName)}" />`
        : '<div class="skeleton" style="position:absolute;inset:0;"></div>';
      return `
        <div class="preview-frame" data-id="${entry.id}">
          ${thumb}
          <span class="frame-tag">${frameLabel}</span>
          <button type="button" class="frame-remove" data-action="remove-image" data-id="${entry.id}" aria-label="Remove ${escapeHtml(entry.fileName)}">
            ${ICONS.close}
          </button>
          <span class="frame-size">${formatFileSize(entry.fileSize)}</span>
        </div>
      `;
    })
    .join('');
}

function updateAnalyzeButtonState() {
  const hasImages = state.images.length > 0;
  const hasUnprocessed = state.images.some((img) => img.status !== 'done');
  btnAnalyze.disabled = !hasImages || state.isProcessing;

  if (state.isProcessing) {
    btnAnalyzeIcon.classList.add('animate-spin');
    btnAnalyzeLabel.textContent = 'Analyzing…';
  } else {
    btnAnalyzeIcon.classList.remove('animate-spin');
    btnAnalyzeLabel.textContent = hasImages && !hasUnprocessed ? 'Re-analyze images' : 'Analyze images';
  }
}

// ----------------------------------------------------------------------------
// 11. Analysis orchestration
// ----------------------------------------------------------------------------
async function startAnalysis() {
  if (state.isProcessing || !state.images.length) return;

  state.isProcessing = true;
  updateAnalyzeButtonState();
  dashboardSection.classList.remove('hidden');
  smoothScrollTo('dashboard');

  // A re-run clears previous results so the batch is analyzed fresh.
  state.images.forEach((entry) => {
    entry.status = 'pending';
    entry.result = null;
    entry.error = null;
  });

  renderResultsList();
  updateProgress();

  // Images are analyzed one at a time — this keeps progress reporting
  // meaningful and stays friendly to Gemini API rate limits.
  for (const entry of state.images) {
    await analyzeOne(entry);
  }

  state.isProcessing = false;
  updateAnalyzeButtonState();
  updateProgress(true);
  exportAllBar.classList.toggle('hidden', !state.images.some((img) => img.status === 'done'));

  const failedCount = state.images.filter((img) => img.status === 'error').length;
  if (failedCount) {
    showToast(`Done, with ${failedCount} image(s) that need a retry.`, 'error');
  } else {
    showToast('Analysis complete.', 'success');
  }
}

async function analyzeOne(entry) {
  entry.status = 'processing';
  renderResultsList();
  updateProgress();

  try {
    if (!entry.base64) {
      throw new Error('This image could not be prepared for analysis. Try removing and re-adding it.');
    }

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: entry.base64,
        mimeType: entry.mimeType,
        fileName: entry.fileName,
      }),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload || !payload.success) {
      throw new Error((payload && payload.error) || `Analysis failed (status ${response.status}).`);
    }

    entry.result = payload.data;
    entry.status = 'done';
    entry.error = null;
  } catch (err) {
    entry.status = 'error';
    entry.error = err && err.message ? err.message : 'Something went wrong analyzing this image.';
  }

  renderResultsList();
  updateProgress();
}

async function retryImage(id) {
  const entry = getEntryById(id);
  if (!entry || entry.status === 'processing') return;
  entry.status = 'pending';
  entry.error = null;
  renderResultsList();
  await analyzeOne(entry);
  exportAllBar.classList.toggle('hidden', !state.images.some((img) => img.status === 'done'));
}

function updateProgress(isFinal = false) {
  const total = state.images.length;
  const done = state.images.filter((img) => img.status === 'done').length;
  const failed = state.images.filter((img) => img.status === 'error').length;
  const processingIndex = state.images.findIndex((img) => img.status === 'processing');

  const percent = total ? Math.round(((done + failed) / total) * 100) : 0;
  progressBarFill.style.width = `${percent}%`;
  progressFraction.textContent = `${done + failed} / ${total}`;

  if (isFinal) {
    progressText.textContent = failed
      ? `Done — ${done} analyzed, ${failed} failed.`
      : `All ${total} image${total === 1 ? '' : 's'} analyzed.`;
  } else if (processingIndex > -1) {
    progressText.textContent = `Analyzing image ${processingIndex + 1} of ${total}…`;
  } else {
    progressText.textContent = 'Preparing…';
  }
}

// ----------------------------------------------------------------------------
// 12. Results dashboard rendering
// ----------------------------------------------------------------------------
function statusBadgeHtml(status) {
  const map = {
    pending: { label: 'Waiting', cls: 'status-pending' },
    processing: { label: 'Analyzing', cls: 'status-processing' },
    done: { label: 'Complete', cls: 'status-done' },
    error: { label: 'Failed', cls: 'status-error' },
  };
  const s = map[status] || map.pending;
  return `<span class="status-badge ${s.cls}"><span class="status-dot"></span>${s.label}</span>`;
}

function loadingDetailsHtml() {
  return `
    <div class="pt-4 space-y-2.5">
      <div class="skeleton h-4 rounded" style="width:75%"></div>
      <div class="skeleton h-4 rounded" style="width:100%"></div>
      <div class="skeleton h-4 rounded" style="width:85%"></div>
      <div class="flex gap-2 pt-1">
        <div class="skeleton h-6 rounded-full" style="width:5rem"></div>
        <div class="skeleton h-6 rounded-full" style="width:6rem"></div>
        <div class="skeleton h-6 rounded-full" style="width:4rem"></div>
      </div>
    </div>
  `;
}

function errorDetailsHtml(entry) {
  return `
    <div class="pt-4">
      <p class="text-sm text-rust-600 dark:text-rust-400">${escapeHtml(entry.error || 'Something went wrong analyzing this image.')}</p>
      <button type="button" class="btn-outline btn-xs mt-3" data-action="retry-image" data-id="${entry.id}">
        ${ICONS.refresh} Retry
      </button>
    </div>
  `;
}

function resultDetailsHtml(entry) {
  const r = entry.result;
  const keywordsHtml = r.keywords.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join('');
  const colorsText = r.colors && r.colors.length ? r.colors.join(', ') : '—';

  return `
    <div class="pt-1">
      <div class="subcard">
        <p class="subcard-title">Metadata</p>
        <div class="data-row"><span class="data-label">Title</span><span class="data-value">${escapeHtml(r.title)}</span></div>
        <div class="data-row"><span class="data-label">Short desc.</span><span class="data-value">${escapeHtml(r.shortDescription)}</span></div>
        <div class="data-row"><span class="data-label">Long desc.</span><span class="data-value">${escapeHtml(r.longDescription)}</span></div>
        <div class="data-row"><span class="data-label">Category</span><span class="data-value">${escapeHtml(r.category)}${r.subcategory ? ' / ' + escapeHtml(r.subcategory) : ''}</span></div>
        <div class="data-row"><span class="data-label">Style</span><span class="data-value">${escapeHtml(r.imageStyle) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Subject</span><span class="data-value">${escapeHtml(r.subject) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Mood</span><span class="data-value">${escapeHtml(r.mood) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Colors</span><span class="data-value">${escapeHtml(colorsText)}</span></div>
        <div class="data-row"><span class="data-label">Composition</span><span class="data-value">${escapeHtml(r.composition) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Lighting</span><span class="data-value">${escapeHtml(r.lighting) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Orientation</span><span class="data-value">${escapeHtml(r.orientation)}</span></div>
        <div class="data-row"><span class="data-label">Copy space</span><span class="data-value">${escapeHtml(r.copySpace)}</span></div>
        <div class="data-row"><span class="data-label">Commercial use</span><span class="data-value">${escapeHtml(r.commercialUseSuggestions) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Editorial/Comm.</span><span class="data-value">${escapeHtml(r.editorialOrCommercial)}</span></div>
      </div>

      <div class="subcard">
        <p class="subcard-title">Keywords (${r.keywords.length})</p>
        <div class="flex flex-wrap gap-1.5">${keywordsHtml}</div>
      </div>

      <div class="subcard">
        <p class="subcard-title">Quality scores</p>
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div class="score-mini"><span>SEO</span><b>${r.seoScore}</b></div>
          <div class="score-mini"><span>Keywords</span><b>${r.keywordQualityScore}</b></div>
          <div class="score-mini"><span>Metadata</span><b>${r.metadataQualityScore}</b></div>
          <div class="score-mini"><span>Confidence</span><b>${r.aiConfidenceScore}</b></div>
        </div>
      </div>

      <div class="subcard">
        <p class="subcard-title">Marketplace mapping</p>
        <div class="data-row"><span class="data-label">Adobe Stock</span><span class="data-value">${escapeHtml(r.adobeStockCategory) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Shutterstock</span><span class="data-value">${escapeHtml(r.shutterstockCategory) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Freepik</span><span class="data-value">${escapeHtml(r.freepikCategory) || '—'}</span></div>
        <div class="data-row"><span class="data-label">Best fit</span><span class="data-value">${escapeHtml(r.bestMarketplace) || '—'}</span></div>
      </div>

      <div class="action-row">
        <button type="button" class="btn-outline btn-xs" data-action="copy-metadata" data-id="${entry.id}">${ICONS.copy} Copy metadata</button>
        <button type="button" class="btn-outline btn-xs" data-action="copy-keywords" data-id="${entry.id}">${ICONS.copy} Copy keywords</button>
        <button type="button" class="btn-outline btn-xs" data-action="copy-description" data-id="${entry.id}">${ICONS.copy} Copy description</button>
        <button type="button" class="btn-outline btn-xs" data-action="copy-everything" data-id="${entry.id}">${ICONS.copy} Copy everything</button>
      </div>
      <div class="action-row">
        <button type="button" class="btn-primary btn-xs" data-action="export-single-txt" data-id="${entry.id}">${ICONS.download} TXT</button>
        <button type="button" class="btn-primary btn-xs" data-action="export-single-csv" data-id="${entry.id}">${ICONS.download} CSV</button>
        <button type="button" class="btn-primary btn-xs" data-action="export-single-json" data-id="${entry.id}">${ICONS.download} JSON</button>
      </div>
    </div>
  `;
}

function resultCardHtml(entry, index) {
  const frameLabel = `F${String(index + 1).padStart(2, '0')}`;
  const thumb = entry.dataUrl
    ? `<img src="${entry.dataUrl}" alt="" class="result-thumb" />`
    : '<div class="result-thumb skeleton"></div>';
  const titleText = (entry.result && entry.result.title) || entry.fileName;

  let body;
  if (entry.status === 'done' && entry.result) {
    body = resultDetailsHtml(entry);
  } else if (entry.status === 'error') {
    body = errorDetailsHtml(entry);
  } else {
    body = loadingDetailsHtml();
  }

  return `
    <div class="result-card" data-id="${entry.id}">
      <button type="button" class="result-header" data-action="toggle-result" data-id="${entry.id}" aria-expanded="false" aria-controls="result-body-${entry.id}">
        ${thumb}
        <div class="result-meta">
          <p class="result-filename">${frameLabel} · ${escapeHtml(entry.fileName)}</p>
          <p class="result-title">${escapeHtml(titleText)}</p>
        </div>
        ${statusBadgeHtml(entry.status)}
        <svg class="result-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div id="result-body-${entry.id}" class="result-body">
        <div class="result-body-inner">
          <div class="result-body-content">${body}</div>
        </div>
      </div>
    </div>
  `;
}

function setCardOpen(id, open) {
  const header = resultsList.querySelector(`.result-header[data-id="${id}"]`);
  const body = document.getElementById(`result-body-${id}`);
  if (!header || !body) return;
  header.setAttribute('aria-expanded', String(open));
  body.classList.toggle('is-open', open);
}

function toggleResultCard(id) {
  const isOpen = state.openCardIds.has(id);
  if (isOpen) {
    state.openCardIds.delete(id);
  } else {
    state.openCardIds.add(id);
  }
  setCardOpen(id, !isOpen);
}

function renderResultsList() {
  resultsList.innerHTML = state.images.map((entry, index) => resultCardHtml(entry, index)).join('');
  state.openCardIds.forEach((id) => setCardOpen(id, true));
}

// ----------------------------------------------------------------------------
// 13. Copy to clipboard
// ----------------------------------------------------------------------------
async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied to clipboard.`, 'success');
  } catch (err) {
    showToast('Could not copy — your browser may be blocking clipboard access.', 'error');
  }
}

function copyMetadata(id) {
  const entry = getEntryById(id);
  if (!entry || !entry.result) return;
  const r = entry.result;
  copyText(
    [
      `Title: ${r.title}`,
      `Short description: ${r.shortDescription}`,
      `Long description: ${r.longDescription}`,
      `Category: ${r.category}${r.subcategory ? ' / ' + r.subcategory : ''}`,
      `Style: ${r.imageStyle}`,
      `Subject: ${r.subject}`,
      `Mood: ${r.mood}`,
      `Colors: ${r.colors.join(', ')}`,
      `Composition: ${r.composition}`,
      `Lighting: ${r.lighting}`,
      `Orientation: ${r.orientation}`,
      `Copy space: ${r.copySpace}`,
      `Commercial use: ${r.commercialUseSuggestions}`,
      `Editorial/Commercial: ${r.editorialOrCommercial}`,
    ].join('\n'),
    'Metadata'
  );
}

function copyKeywords(id) {
  const entry = getEntryById(id);
  if (!entry || !entry.result) return;
  copyText(entry.result.keywords.join(', '), 'Keywords');
}

function copyDescription(id) {
  const entry = getEntryById(id);
  if (!entry || !entry.result) return;
  copyText(entry.result.longDescription, 'Description');
}

function copyEverything(id) {
  const entry = getEntryById(id);
  if (!entry || !entry.result) return;
  copyText(buildTxtBlock(entry), 'Full metadata');
}

// ----------------------------------------------------------------------------
// 14. Export (TXT / CSV / JSON)
// ----------------------------------------------------------------------------
function buildTxtBlock(entry) {
  const r = entry.result;
  if (!r) return `FILE: ${entry.fileName}\n(No result available)\n`;
  return [
    '='.repeat(60),
    `FILE: ${entry.fileName}`,
    '='.repeat(60),
    `TITLE: ${r.title}`,
    `SHORT DESCRIPTION: ${r.shortDescription}`,
    `LONG DESCRIPTION: ${r.longDescription}`,
    '',
    `KEYWORDS (${r.keywords.length}):`,
    r.keywords.join(', '),
    '',
    `CATEGORY: ${r.category}`,
    `SUBCATEGORY: ${r.subcategory}`,
    `ADOBE STOCK CATEGORY: ${r.adobeStockCategory}`,
    `SHUTTERSTOCK CATEGORY: ${r.shutterstockCategory}`,
    `FREEPIK CATEGORY: ${r.freepikCategory}`,
    `IMAGE STYLE: ${r.imageStyle}`,
    `SUBJECT: ${r.subject}`,
    `MOOD: ${r.mood}`,
    `COLORS: ${r.colors.join(', ')}`,
    `COMPOSITION: ${r.composition}`,
    `LIGHTING: ${r.lighting}`,
    `ORIENTATION: ${r.orientation}`,
    `COPY SPACE: ${r.copySpace}`,
    `COMMERCIAL USE SUGGESTIONS: ${r.commercialUseSuggestions}`,
    `EDITORIAL OR COMMERCIAL: ${r.editorialOrCommercial}`,
    `BEST MARKETPLACE: ${r.bestMarketplace}`,
    '',
    `AI CONFIDENCE SCORE: ${r.aiConfidenceScore}`,
    `SEO SCORE: ${r.seoScore}`,
    `KEYWORD QUALITY SCORE: ${r.keywordQualityScore}`,
    `METADATA QUALITY SCORE: ${r.metadataQualityScore}`,
    '',
    '',
  ].join('\n');
}

const CSV_COLUMNS = [
  ['fileName', (e) => e.fileName],
  ['title', (e) => e.result && e.result.title],
  ['shortDescription', (e) => e.result && e.result.shortDescription],
  ['longDescription', (e) => e.result && e.result.longDescription],
  ['keywords', (e) => e.result && e.result.keywords.join('; ')],
  ['category', (e) => e.result && e.result.category],
  ['subcategory', (e) => e.result && e.result.subcategory],
  ['adobeStockCategory', (e) => e.result && e.result.adobeStockCategory],
  ['shutterstockCategory', (e) => e.result && e.result.shutterstockCategory],
  ['freepikCategory', (e) => e.result && e.result.freepikCategory],
  ['imageStyle', (e) => e.result && e.result.imageStyle],
  ['subject', (e) => e.result && e.result.subject],
  ['mood', (e) => e.result && e.result.mood],
  ['colors', (e) => e.result && e.result.colors.join('; ')],
  ['composition', (e) => e.result && e.result.composition],
  ['lighting', (e) => e.result && e.result.lighting],
  ['orientation', (e) => e.result && e.result.orientation],
  ['copySpace', (e) => e.result && e.result.copySpace],
  ['commercialUseSuggestions', (e) => e.result && e.result.commercialUseSuggestions],
  ['editorialOrCommercial', (e) => e.result && e.result.editorialOrCommercial],
  ['bestMarketplace', (e) => e.result && e.result.bestMarketplace],
  ['aiConfidenceScore', (e) => e.result && e.result.aiConfidenceScore],
  ['seoScore', (e) => e.result && e.result.seoScore],
  ['keywordQualityScore', (e) => e.result && e.result.keywordQualityScore],
  ['metadataQualityScore', (e) => e.result && e.result.metadataQualityScore],
];

function csvEscape(value) {
  const str = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function buildCsv(entries) {
  const header = CSV_COLUMNS.map(([name]) => csvEscape(name)).join(',');
  const rows = entries.map((entry) => CSV_COLUMNS.map(([, getter]) => csvEscape(getter(entry))).join(','));
  return [header, ...rows].join('\r\n');
}

function buildJson(entries) {
  return JSON.stringify(
    entries.map((entry) => ({
      fileName: entry.fileName,
      status: entry.status,
      metadata: entry.result || null,
    })),
    null,
    2
  );
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 200);
}

function exportSingle(id, format) {
  const entry = getEntryById(id);
  if (!entry || !entry.result) {
    showToast('This image has not finished analyzing yet.', 'error');
    return;
  }
  const baseName = entry.fileName.replace(/\.[^.]+$/, '') || 'metadata';
  if (format === 'txt') downloadFile(buildTxtBlock(entry), `${baseName}.txt`, 'text/plain');
  if (format === 'csv') downloadFile(buildCsv([entry]), `${baseName}.csv`, 'text/csv');
  if (format === 'json') downloadFile(buildJson([entry]), `${baseName}.json`, 'application/json');
  showToast(`Exported ${format.toUpperCase()}.`, 'success');
}

function exportAll(format) {
  const done = state.images.filter((img) => img.status === 'done');
  if (!done.length) {
    showToast('No completed results to export yet.', 'error');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'txt') downloadFile(done.map(buildTxtBlock).join('\n'), `stock-metadata-${stamp}.txt`, 'text/plain');
  if (format === 'csv') downloadFile(buildCsv(done), `stock-metadata-${stamp}.csv`, 'text/csv');
  if (format === 'json') downloadFile(buildJson(done), `stock-metadata-${stamp}.json`, 'application/json');
  showToast(`Exported ${done.length} result(s) as ${format.toUpperCase()}.`, 'success');
}

// ----------------------------------------------------------------------------
// 15. Toast notifications
// ----------------------------------------------------------------------------
function showToast(message, type = 'success') {
  const icon = type === 'success' ? ICONS.check : ICONS.alert;
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }, TOAST_LIFETIME_MS);
}

// ----------------------------------------------------------------------------
// 16. Event wiring & init
// ----------------------------------------------------------------------------
function initDelegatedClicks() {
  document.addEventListener('click', (event) => {
    const scrollBtn = event.target.closest('[data-scroll-to]');
    if (scrollBtn) smoothScrollTo(scrollBtn.getAttribute('data-scroll-to'));

    const rippleBtn = event.target.closest('.btn-ripple');
    if (rippleBtn) addRipple(rippleBtn, event);

    const actionEl = event.target.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');
    const id = actionEl.getAttribute('data-id');

    const actions = {
      'remove-image': () => removeImage(id),
      'toggle-result': () => toggleResultCard(id),
      'retry-image': () => retryImage(id),
      'copy-metadata': () => copyMetadata(id),
      'copy-keywords': () => copyKeywords(id),
      'copy-description': () => copyDescription(id),
      'copy-everything': () => copyEverything(id),
      'export-single-txt': () => exportSingle(id, 'txt'),
      'export-single-csv': () => exportSingle(id, 'csv'),
      'export-single-json': () => exportSingle(id, 'json'),
    };

    if (actions[action]) actions[action]();
  });

  document.querySelectorAll('.faq-question').forEach((btn) => {
    btn.addEventListener('click', () => toggleFaqItem(btn));
  });
}

function init() {
  initTheme();
  initScrollReveal();
  initDropzone();
  initDelegatedClicks();

  themeToggleBtn.addEventListener('click', toggleTheme);
  mobileMenuBtn.addEventListener('click', () => toggleMobileMenu());
  document.querySelectorAll('#mobile-menu a, #mobile-menu button').forEach((el) => {
    el.addEventListener('click', () => toggleMobileMenu(false));
  });

  btnClearAll.addEventListener('click', clearAll);
  btnAnalyze.addEventListener('click', startAnalysis);
  btnExportAllTxt.addEventListener('click', () => exportAll('txt'));
  btnExportAllCsv.addEventListener('click', () => exportAll('csv'));
  btnExportAllJson.addEventListener('click', () => exportAll('json'));

  if (footerYear) footerYear.textContent = String(new Date().getFullYear());
}

document.addEventListener('DOMContentLoaded', init);
