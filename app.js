const STORAGE_KEY = 'ledger_expenses';
const BUDGET_KEY = 'ledger_budget';
const DEBUG_KEY = 'ledger_debug';
const PAGE_SIZE = 100;

const DEBUG = localStorage.getItem(DEBUG_KEY) === 'true';
function debugLog(...args) {
  if (DEBUG) console.log('[ledger]', ...args);
}

const CATEGORY_EMOJI = {
  'Food & Drink': '🍔',
  'Transport': '🚗',
  'Housing': '🏠',
  'Health': '💊',
  'Shopping': '🛍️',
  'Entertainment': '🎬',
  'Utilities': '💡',
  'Other': '📦',
};

// --- State ---
let expenses = load();
let visibleCount = PAGE_SIZE;
let searchQuery = '';
let budgetLimit = loadBudget();
let showFavoritesOnly = false;
let filterTag = null;
let exportExpenseId = null;
let deleteStack = [];
let pendingExpense = null;
let pendingReceiptImage = null;

// --- Search index ---
// Inverted index: token → Set<expenseId>.
// queryIndex results are memoised in a small LRU keyed by the raw query string;
// the cache is cleared whenever the index mutates so results never go stale.

class LRU {
  constructor(max) { this.max = max; this.map = new Map(); }
  get(k) {
    if (!this.map.has(k)) return undefined;
    const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v;
  }
  set(k, v) {
    if (this.map.has(k)) this.map.delete(k);
    else if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(k, v);
  }
  clear() { this.map.clear(); }
}

let searchIndex = new Map();
const queryCache = new LRU(64);
buildIndex();

function buildIndex() {
  searchIndex = new Map();
  queryCache.clear();
  for (const e of expenses) indexAdd(e);
}

function expenseTokens(expense) {
  const toks = tokenize(expense.note);
  for (const tag of (expense.tags ?? [])) for (const t of tokenize(tag)) toks.push(t);
  return toks;
}

function indexAdd(expense) {
  for (const tok of expenseTokens(expense)) {
    let ids = searchIndex.get(tok);
    if (!ids) { ids = new Set(); searchIndex.set(tok, ids); }
    ids.add(expense.id);
  }
  queryCache.clear();
}

function indexRemove(expense) {
  for (const tok of expenseTokens(expense)) {
    searchIndex.get(tok)?.delete(expense.id);
  }
  queryCache.clear();
}

function parseTags(input) {
  return [...new Set(input.split(',').map(t => t.trim().toLowerCase()).filter(Boolean))];
}

function tokenize(note) {
  if (!note) return [];
  return note.toLowerCase().split(/\W+/).filter(Boolean);
}

// Returns Set<id> matching all query terms (prefix per term), or null when query is empty.
function queryIndex(query) {
  const terms = tokenize(query);
  if (!terms.length) return null;
  const cached = queryCache.get(query);
  if (cached !== undefined) return cached;
  let result = null;
  for (const term of terms) {
    const ids = new Set();
    for (const [key, set] of searchIndex) {
      if (key.startsWith(term)) for (const id of set) ids.add(id);
    }
    result = result === null ? ids : intersectSets(result, ids);
  }
  queryCache.set(query, result);
  return result;
}

function intersectSets(a, b) {
  const out = new Set();
  for (const id of a) if (b.has(id)) out.add(id);
  return out;
}

// --- Budget storage ---
function loadBudget() {
  const v = parseFloat(localStorage.getItem(BUDGET_KEY));
  return isNaN(v) || v <= 0 ? null : v;
}

function saveBudget(value) {
  if (value === null) {
    localStorage.removeItem(BUDGET_KEY);
  } else {
    localStorage.setItem(BUDGET_KEY, String(value));
  }
  budgetLimit = value;
}

// --- DOM refs ---
const form = document.getElementById('expense-form');
const amountInput = document.getElementById('amount');
const amountError = document.getElementById('amount-error');
const categoryInput = document.getElementById('category');
const noteInput = document.getElementById('note');
const list = document.getElementById('expense-list');
const totalEl = document.getElementById('total');
const yearTotalEl = document.getElementById('year-total');
const monthTotalEl = document.getElementById('month-total');
const countEl = document.getElementById('count');
const breakdownSection = document.getElementById('breakdown-section');
const breakdownList = document.getElementById('breakdown-list');
const tagsInput = document.getElementById('tags');
const tagCloud = document.getElementById('tag-cloud');
const filterSelect = document.getElementById('filter-category');
const filterSubtotal = document.getElementById('filter-subtotal');
const filterSubtotalLabel = document.getElementById('filter-subtotal-label');
const filterSubtotalAmount = document.getElementById('filter-subtotal-amount');
const searchInput = document.getElementById('search');
const searchClear = document.getElementById('search-clear');
const exportBtn = document.getElementById('export-csv');
const clearBtn = document.getElementById('clear-all');
const monthExport = document.getElementById('month-export');
const monthExportSelect = document.getElementById('month-export-select');
const monthExportBtn = document.getElementById('month-export-btn');
const favoritesToggle = document.getElementById('favorites-toggle');
const dupeWarning   = document.getElementById('dupe-warning');
const dupeWarningMsg = document.getElementById('dupe-warning-msg');
const dupeAddAnyway = document.getElementById('dupe-add-anyway');
const dupeCancelBtn = document.getElementById('dupe-cancel');
const receiptInput = document.getElementById('receipt-input');
const receiptUploadLabel = document.getElementById('receipt-upload-label');
const receiptUploadPreview = document.getElementById('receipt-upload-preview');
const receiptUploadImg = document.getElementById('receipt-upload-img');
const receiptUploadFilename = document.getElementById('receipt-upload-filename');
const receiptUploadClear = document.getElementById('receipt-upload-clear');
const imgLightbox = document.getElementById('img-lightbox');
const lightboxClose = document.getElementById('lightbox-close');
const lightboxImg = document.getElementById('lightbox-img');
const receiptBackdrop = document.getElementById('receipt-backdrop');
const receiptDialog = document.getElementById('receipt-dialog');
const receiptPreview = document.getElementById('receipt-preview');
const receiptClose = document.getElementById('receipt-close');
const receiptCancel = document.getElementById('receipt-cancel');
const receiptDownload = document.getElementById('receipt-download');
const toast = document.getElementById('toast');
const fab = document.getElementById('open-modal');
const backdrop = document.getElementById('modal-backdrop');
const drawer = document.getElementById('modal-drawer');
const budgetBtn = document.getElementById('budget-btn');
const budgetDisplay = document.getElementById('budget-display');
const budgetForm = document.getElementById('budget-form');
const budgetInput = document.getElementById('budget-input');
const budgetCancel = document.getElementById('budget-cancel');
const budgetAlert = document.getElementById('budget-alert');
const budgetAlertMsg = document.getElementById('budget-alert-msg');
const splitToggle = document.getElementById('split-toggle');
const splitControls = document.getElementById('split-controls');
const splitCountInput = document.getElementById('split-count');
const splitSharePreview = document.getElementById('split-share-preview');

// --- Split helpers ---
function effectiveAmount(expense) {
  if (!expense.splitWith) return expense.amount;
  const totalCents = Math.round(expense.amount * 100);
  const n = expense.splitWith;
  const otherCents = Math.floor(totalCents / n);
  return (totalCents - (n - 1) * otherCents) / 100;
}

function updateSplitPreview() {
  if (!splitToggle.checked) return;
  const total = parseFloat(amountInput.value);
  const n = parseInt(splitCountInput.value, 10);
  if (total > 0 && n >= 2) {
    const totalCents = Math.round(total * 100);
    const otherCents = Math.floor(totalCents / n);
    const myCents = totalCents - (n - 1) * otherCents;
    splitSharePreview.textContent = `· your share: ${formatCurrency(myCents / 100)}`;
  } else {
    splitSharePreview.textContent = '';
  }
}

// Sentinel node watched by IntersectionObserver to trigger loading the next page.
const sentinel = document.createElement('li');
sentinel.className = 'scroll-sentinel';
const scrollObserver = new IntersectionObserver(([entry]) => {
  if (!entry.isIntersecting) return;
  visibleCount += PAGE_SIZE;
  render();
}, { rootMargin: '200px' });

// --- Init ---
render();

// --- Modal ---
function openModal() {
  drawer.classList.add('is-open');
  backdrop.classList.add('is-open');
  fab.classList.add('is-open');
  setTimeout(() => amountInput.focus(), 300);
}

function closeModal() {
  drawer.classList.remove('is-open');
  backdrop.classList.remove('is-open');
  fab.classList.remove('is-open');
  pendingExpense = null;
  dupeWarning.hidden = true;
  clearAmountError();
  clearReceiptUpload();
  splitToggle.checked = false;
  splitControls.hidden = true;
  splitCountInput.value = '2';
  splitSharePreview.textContent = '';
}

function clearReceiptUpload() {
  pendingReceiptImage = null;
  receiptInput.value = '';
  receiptUploadPreview.hidden = true;
  receiptUploadLabel.hidden = false;
}

fab.addEventListener('click', () => {
  drawer.classList.contains('is-open') ? closeModal() : openModal();
});

backdrop.addEventListener('click', closeModal);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!imgLightbox.hidden) { closeLightbox(); return; }
    closeModal();
  }
});

splitToggle.addEventListener('change', () => {
  splitControls.hidden = !splitToggle.checked;
  if (splitToggle.checked) {
    splitCountInput.focus();
    updateSplitPreview();
  }
});

splitCountInput.addEventListener('input', updateSplitPreview);
amountInput.addEventListener('input', updateSplitPreview);

// --- Event delegation for delete + favorite + export (one listener instead of one per item) ---
list.addEventListener('click', e => {
  const del = e.target.closest('.delete-btn');
  if (del) {
    const li = del.closest('[data-id]');
    if (li) deleteExpense(li.dataset.id);
    return;
  }
  const star = e.target.closest('.favorite-btn');
  if (star) {
    const li = star.closest('[data-id]');
    if (li) toggleFavorite(li.dataset.id);
    return;
  }
  const rec = e.target.closest('.recurrence-btn');
  if (rec) {
    const li = rec.closest('[data-id]');
    if (li) toggleRecurrence(li.dataset.id);
    return;
  }
  const exp = e.target.closest('.export-btn');
  if (exp) {
    const li = exp.closest('[data-id]');
    if (li) openReceiptDialog(li.dataset.id);
    return;
  }
  const itag = e.target.closest('.item-tag');
  if (itag) {
    filterTag = itag.dataset.tag;
    visibleCount = PAGE_SIZE;
    render();
    return;
  }
  const thumb = e.target.closest('.receipt-thumb');
  if (thumb) {
    const li = thumb.closest('[data-id]');
    if (li) {
      const expense = expenses.find(ex => ex.id === li.dataset.id);
      if (expense?.receiptImage) openLightbox(expense.receiptImage);
    }
  }
});

amountInput.addEventListener('input', () => {
  if (amountInput.classList.contains('is-invalid')) clearAmountError();
});

function setAmountError(msg) {
  amountError.textContent = msg;
  amountError.hidden = false;
  amountInput.classList.add('is-invalid');
  amountInput.setAttribute('aria-describedby', 'amount-error');
  amountInput.setAttribute('aria-invalid', 'true');
}

function clearAmountError() {
  amountError.hidden = true;
  amountInput.classList.remove('is-invalid');
  amountInput.removeAttribute('aria-describedby');
  amountInput.removeAttribute('aria-invalid');
}

// --- Form ---
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) {
    const msg = amountInput.value !== '' && parseFloat(amountInput.value) <= 0
      ? 'Amount must be greater than zero.'
      : 'Please enter an amount.';
    setAmountError(msg);
    amountInput.focus();
    return;
  }
  clearAmountError();

  const tags = parseTags(tagsInput.value);

  const splitWith = splitToggle.checked ? Math.max(2, parseInt(splitCountInput.value, 10) || 2) : undefined;
  const expense = {
    id: crypto.randomUUID(),
    amount,
    category: categoryInput.value,
    note: noteInput.value.trim(),
    tags: tags.length ? tags : undefined,
    date: new Date().toISOString(),
    splitWith,
  };

  const dupe = findDuplicate(expense);
  if (dupe) {
    pendingExpense = expense;
    const msg = `Already logged ${formatCurrency(dupe.amount)} for ${dupe.category} today${dupe.note ? ` — "${dupe.note}"` : ''}.`;
    dupeWarningMsg.textContent = msg;
    dupeWarning.hidden = false;
    return;
  }

  commitExpense(expense);
});

// Any field edit after a warning appears means the user changed their input — stale warning must go.
form.addEventListener('input', () => {
  if (!pendingExpense) return;
  pendingExpense = null;
  dupeWarning.hidden = true;
});

dupeAddAnyway.addEventListener('click', () => {
  const expense = pendingExpense;
  if (!expense) return;
  pendingExpense = null;
  dupeWarning.hidden = true;
  commitExpense(expense);
});

dupeCancelBtn.addEventListener('click', () => {
  pendingExpense = null;
  dupeWarning.hidden = true;
});

// --- Receipt image upload ---
receiptInput.addEventListener('change', () => {
  const file = receiptInput.files[0];
  if (!file) return;
  compressImage(file, 800, 0.65).then(dataUrl => {
    pendingReceiptImage = dataUrl;
    receiptUploadImg.src = dataUrl;
    receiptUploadFilename.textContent = file.name;
    receiptUploadLabel.hidden = true;
    receiptUploadPreview.hidden = false;
  });
});

receiptUploadClear.addEventListener('click', clearReceiptUpload);

function compressImage(file, maxPx, quality) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// --- Image lightbox ---
function openLightbox(src) {
  lightboxImg.src = src;
  imgLightbox.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  imgLightbox.hidden = true;
  lightboxImg.src = '';
  document.body.style.overflow = '';
}

lightboxClose.addEventListener('click', closeLightbox);
imgLightbox.addEventListener('click', (e) => { if (e.target === imgLightbox) closeLightbox(); });

function commitExpense(expense) {
  if (pendingReceiptImage) expense.receiptImage = pendingReceiptImage;
  debugLog('expense added', expense);
  expenses.unshift(expense);
  indexAdd(expense);
  save();
  render();
  form.reset();
  categoryInput.value = '';
  closeModal();
  showToast('Expense added');
}

// Returns the most recent stored expense that looks like a duplicate of `candidate`,
// or null if none is found.
//
// Strategy: filter the full list to entries sharing the same amount AND calendar day,
// then check at most 5 of those for description similarity. Filtering on amount+day first
// is what keeps this correct as history grows — unrelated newer entries can never push a
// genuine same-amount/same-day match outside the comparison window.
function findDuplicate(candidate) {
  const d = new Date(candidate.date);
  const cy = d.getFullYear(), cm = d.getMonth(), cd = d.getDate();

  let checked = 0;
  for (const e of expenses) {
    const ed = new Date(e.date);
    if (e.amount !== candidate.amount) continue;
    if (ed.getFullYear() !== cy || ed.getMonth() !== cm || ed.getDate() !== cd) continue;
    if (notesSimilar(e.note, candidate.note)) return e;
    if (++checked === 5) break;
  }
  return null;
}

function notesSimilar(a, b) {
  if (!a && !b) return true;   // same amount + same day with no description on either is suspicious
  if (!a || !b) return false;  // one described, one not — likely different entries
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared) >= 0.5; // Jaccard similarity
}

filterSelect.addEventListener('change', () => {
  visibleCount = PAGE_SIZE;
  render();
});

let searchTimer;
searchInput.addEventListener('input', () => {
  searchClear.hidden = !searchInput.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchQuery = searchInput.value.trim().toLowerCase();
    visibleCount = PAGE_SIZE;
    render();
  }, 250);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.hidden = true;
  visibleCount = PAGE_SIZE;
  render();
  searchInput.focus();
});

favoritesToggle.addEventListener('click', () => {
  showFavoritesOnly = !showFavoritesOnly;
  favoritesToggle.classList.toggle('is-active', showFavoritesOnly);
  favoritesToggle.setAttribute('aria-pressed', String(showFavoritesOnly));
  visibleCount = PAGE_SIZE;
  render();
});

tagCloud.addEventListener('click', e => {
  const chip = e.target.closest('.tag-chip');
  if (!chip) return;
  filterTag = filterTag === chip.dataset.tag ? null : chip.dataset.tag;
  visibleCount = PAGE_SIZE;
  render();
});

// --- Receipt export dialog ---
function openReceiptDialog(id) {
  exportExpenseId = id;
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  receiptPreview.innerHTML = buildReceiptPreview(expense);
  if (expense.receiptImage) {
    const previewImg = receiptPreview.querySelector('.receipt-preview-img');
    if (previewImg) previewImg.addEventListener('click', () => openLightbox(expense.receiptImage));
  }
  receiptDialog.classList.add('is-open');
  receiptBackdrop.classList.add('is-open');
}

function closeReceiptDialog() {
  receiptDialog.classList.remove('is-open');
  receiptBackdrop.classList.remove('is-open');
  exportExpenseId = null;
}

function buildReceiptPreview(expense) {
  const emoji = CATEGORY_EMOJI[expense.category] ?? '📦';
  const amount = formatCurrency(expense.amount);
  const dateStr = new Date(expense.date).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  return `
    <div class="receipt-preview-amount">${esc(amount)}</div>
    <div class="receipt-preview-meta">
      <span class="receipt-preview-emoji">${emoji}</span>
      <span>${esc(expense.category)}</span>
    </div>
    <div class="receipt-preview-fields">
      <div class="receipt-field">
        <div class="receipt-field-label">Date</div>
        <div class="receipt-field-value">${esc(dateStr)}</div>
      </div>
      ${expense.note ? `<div class="receipt-field receipt-field-wide">
        <div class="receipt-field-label">Note</div>
        <div class="receipt-field-value">${esc(expense.note)}</div>
      </div>` : ''}
      ${expense.receiptImage ? `<div class="receipt-field receipt-field-wide">
        <div class="receipt-field-label">Receipt Photo</div>
        <img class="receipt-preview-img" src="${expense.receiptImage}" alt="Receipt photo" title="Click to enlarge" />
      </div>` : ''}
    </div>`;
}

receiptClose.addEventListener('click', closeReceiptDialog);
receiptCancel.addEventListener('click', closeReceiptDialog);
receiptBackdrop.addEventListener('click', closeReceiptDialog);

receiptDownload.addEventListener('click', () => {
  // Fresh lookup — correct even if expense was mutated since the dialog opened
  const expense = expenses.find(e => e.id === exportExpenseId);
  if (!expense) { closeReceiptDialog(); return; }
  const pdf = generateExpensePDF(expense);
  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateSlug = new Date(expense.date).toISOString().slice(0, 10);
  const catSlug = expense.category.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.href = url;
  a.download = `ledger-${catSlug}-${dateSlug}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
  closeReceiptDialog();
  showToast('PDF downloaded');
});

exportBtn.addEventListener('click', exportCSV);

monthExportBtn.addEventListener('click', () => {
  const key = monthExportSelect.value;
  if (!key) { showToast('Select a month first'); return; }
  const [year, month] = key.split('-').map(Number);
  const slice = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getFullYear() === year && d.getMonth() === month - 1;
  });
  if (!slice.length) { showToast('No expenses for that month'); return; }

  monthExportBtn.disabled = true;
  showToast('Preparing export…');

  const worker = new Worker('export.worker.js');
  worker.onmessage = ({ data: { csv, count } }) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${key}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    monthExportBtn.disabled = false;
    showToast(`Exported ${count} expense${count !== 1 ? 's' : ''}`);
    worker.terminate();
  };
  worker.onerror = (err) => {
    console.error('Export worker error:', err);
    showToast('Export failed');
    monthExportBtn.disabled = false;
    worker.terminate();
  };
  worker.postMessage(slice);
});

clearBtn.addEventListener('click', () => {
  if (!expenses.length) return;
  if (!confirm('Delete all expenses? This cannot be undone.')) return;
  expenses = [];
  deleteStack = [];
  filterTag = null;
  buildIndex();
  save();
  visibleCount = PAGE_SIZE;
  searchInput.value = '';
  searchQuery = '';
  searchClear.hidden = true;
  render();
  showToast('All expenses cleared');
});

// --- Budget editing ---
function openBudgetEdit() {
  budgetBtn.hidden = true;
  budgetForm.hidden = false;
  budgetInput.value = budgetLimit ?? '';
  budgetInput.focus();
}

function closeBudgetEdit() {
  budgetForm.hidden = true;
  budgetBtn.hidden = false;
}

budgetBtn.addEventListener('click', openBudgetEdit);

budgetCancel.addEventListener('click', () => {
  closeBudgetEdit();
});

budgetForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const v = parseFloat(budgetInput.value);
  saveBudget(isNaN(v) || v <= 0 ? null : v);
  closeBudgetEdit();
  render();
});

function populateMonthSelect() {
  const seen = new Set();
  const months = [];
  for (const e of expenses) {
    const d = new Date(e.date);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!seen.has(key)) {
      seen.add(key);
      months.push({ key, label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) });
    }
  }
  monthExport.hidden = months.length === 0;
  const prev = monthExportSelect.value;
  monthExportSelect.innerHTML = '<option value="">Select a month…</option>';
  for (const { key, label } of months) {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = label;
    monthExportSelect.appendChild(opt);
  }
  if (prev && seen.has(prev)) monthExportSelect.value = prev;
}

// --- Render ---
function render() {
  const filter = filterSelect.value;
  const matchIds = searchQuery ? queryIndex(searchQuery) : null;
  let filtered = filter ? expenses.filter(e => e.category === filter) : expenses;
  if (matchIds !== null) filtered = filtered.filter(e => matchIds.has(e.id));
  if (showFavoritesOnly) filtered = filtered.filter(e => e.favorite);
  if (filterTag) filtered = filtered.filter(e => e.tags?.includes(filterTag));

  // Single pass: stats + category totals together
  const now = new Date();
  const ny = now.getFullYear();
  const nm = now.getMonth();
  let total = 0;
  let yearTotal = 0;
  let monthTotal = 0;
  let filterTotal = 0;
  const byCategory = new Map();

  for (const e of expenses) {
    const amt = effectiveAmount(e);
    total += amt;
    const d = new Date(e.date);
    if (d.getFullYear() === ny) yearTotal += amt;
    if (d.getFullYear() === ny && d.getMonth() === nm) monthTotal += amt;
    byCategory.set(e.category, Math.round(((byCategory.get(e.category) ?? 0) + amt) * 100) / 100);
  }
  if (filter || showFavoritesOnly || filterTag) {
    for (const e of filtered) filterTotal += effectiveAmount(e);
  }

  totalEl.textContent = formatCurrency(total);
  yearTotalEl.textContent = formatCurrency(yearTotal);
  monthTotalEl.textContent = formatCurrency(monthTotal);
  countEl.textContent = expenses.length;
  populateMonthSelect();
  updateBudgetAlert(monthTotal);
  if (byCategory.size) {
    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const frag = document.createDocumentFragment();
    for (const [cat, amt] of sorted) {
      const pct = total > 0 ? (amt / total) * 100 : 0;
      const li = document.createElement('li');
      li.className = 'breakdown-item';
      li.innerHTML = `
        <span class="breakdown-emoji" data-cat="${cat}">${CATEGORY_EMOJI[cat] ?? '📦'}</span>
        <div class="breakdown-body">
          <div class="breakdown-row">
            <span class="breakdown-cat">${cat}</span>
            <span class="breakdown-amt">${formatCurrency(amt)}</span>
          </div>
          <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
        </div>
      `;
      frag.appendChild(li);
    }
    breakdownList.innerHTML = '';
    breakdownList.appendChild(frag);
    breakdownSection.hidden = false;
  } else {
    breakdownSection.hidden = true;
  }

  // Tag cloud
  const allTags = new Map();
  for (const e of expenses) for (const t of (e.tags ?? [])) allTags.set(t, (allTags.get(t) ?? 0) + 1);
  if (allTags.size) {
    const frag = document.createDocumentFragment();
    for (const tag of [...allTags.keys()].sort()) {
      const btn = document.createElement('button');
      btn.className = 'tag-chip' + (filterTag === tag ? ' is-active' : '');
      btn.dataset.tag = tag;
      btn.textContent = tag;
      btn.setAttribute('aria-pressed', String(filterTag === tag));
      frag.appendChild(btn);
    }
    tagCloud.innerHTML = '';
    tagCloud.appendChild(frag);
    tagCloud.hidden = false;
  } else {
    tagCloud.hidden = true;
    if (filterTag) filterTag = null;
  }

  if (filter || showFavoritesOnly || filterTag) {
    const parts = [
      showFavoritesOnly ? '★ Favorites' : '',
      filter ? `${CATEGORY_EMOJI[filter] ?? '📦'} ${filter}` : '',
      filterTag ? `#${filterTag}` : '',
    ].filter(Boolean);
    filterSubtotalLabel.textContent = parts.join(' · ');
    filterSubtotalAmount.textContent = formatCurrency(filterTotal);
    filterSubtotal.hidden = false;
  } else {
    filterSubtotal.hidden = true;
  }

  // Stop watching the old sentinel before rebuilding
  scrollObserver.unobserve(sentinel);

  const frag = document.createDocumentFragment();

  if (!filtered.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = showFavoritesOnly
      ? 'No favorited expenses. Tap ★ on any expense to save it here.'
      : searchQuery
        ? 'No matching expenses.'
        : filterTag
          ? `No expenses tagged "${filterTag}".`
          : filter
            ? 'No expenses in this category.'
            : 'No expenses yet. Tap + to add one.';
    frag.appendChild(li);
  } else {
    // Only render the visible slice — the key perf win
    const page = filtered.slice(0, visibleCount);
    for (const expense of page) {
      frag.appendChild(createItem(expense));
    }
    if (filtered.length > visibleCount) {
      frag.appendChild(sentinel);
      scrollObserver.observe(sentinel);
    }
  }

  list.innerHTML = '';
  list.appendChild(frag);
}

function updateBudgetAlert(monthTotal) {
  if (budgetLimit === null) {
    budgetDisplay.textContent = 'Set budget';
    budgetAlert.hidden = true;
    return;
  }
  budgetDisplay.textContent = formatCurrency(budgetLimit) + '/mo';
  if (monthTotal > budgetLimit) {
    const over = monthTotal - budgetLimit;
    budgetAlertMsg.textContent =
      `Monthly budget exceeded — you've spent ${formatCurrency(monthTotal)} of your ${formatCurrency(budgetLimit)} budget (${formatCurrency(over)} over).`;
    budgetAlert.hidden = false;
  } else {
    budgetAlert.hidden = true;
  }
}

function createItem(expense) {
  const li = document.createElement('li');
  li.className = 'expense-item';
  li.dataset.id = expense.id;

  const emoji = CATEGORY_EMOJI[expense.category] ?? '📦';
  const dateStr = formatDate(expense.date);

  const isFav = !!expense.favorite;
  const isRec = !!expense.recurrence;
  const nextDate = nextOccurrence(expense);
  const nextStr = nextDate ? nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  li.innerHTML = `
    <div class="category-badge" data-cat="${expense.category}" title="${expense.category}">${emoji}</div>
    <div class="item-body">
      <div class="item-top">
        <span class="item-category">${expense.category}</span>
        <div class="item-amount-group">
          ${expense.splitWith ? `<span class="item-split-badge">÷${expense.splitWith} · ${formatCurrency(effectiveAmount(expense))}</span>` : ''}
          <span class="item-amount">${formatCurrency(expense.amount)}</span>
        </div>
      </div>
      <div class="item-meta">
        ${expense.note ? `<span class="item-note" title="${esc(expense.note)}">${esc(expense.note)}</span>` : ''}
        <span class="item-date">${dateStr}</span>
        ${nextStr ? `<span class="item-next-occurrence">↻ ${nextStr}</span>` : ''}
      </div>
      ${expense.tags?.length ? `<div class="item-tags">${expense.tags.map(t => `<span class="item-tag" data-tag="${esc(t)}">${esc(t)}</span>`).join('')}</div>` : ''}
    </div>
    ${expense.receiptImage ? `<img class="receipt-thumb" src="${expense.receiptImage}" alt="Receipt" title="View receipt" />` : ''}
    <button class="recurrence-btn${isRec ? ' is-recurring' : ''}" title="${isRec ? 'Remove recurring' : 'Mark as recurring'}" aria-label="${isRec ? 'Remove recurring' : 'Mark as recurring'}" aria-pressed="${isRec}">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M1.5 4.5A5 5 0 0112 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M10 3l2 1.5-2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12.5 9.5A5 5 0 012 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M4 11l-2-1.5L4 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    <button class="favorite-btn${isFav ? ' is-favorite' : ''}" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}" aria-label="${isFav ? 'Remove from favorites' : 'Add to favorites'}" aria-pressed="${isFav}">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" ${isFav ? 'fill="currentColor"' : 'fill="none"'}>
        <path d="M7 1l1.545 3.13L12 4.635l-2.5 2.435.59 3.44L7 8.885 3.91 10.51l.59-3.44L2 4.635l3.455-.505L7 1z" ${isFav ? '' : 'stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"'}/>
      </svg>
    </button>
    <button class="export-btn" title="Export as PDF" aria-label="Export expense as PDF">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M4 4.5h4M4 6.5h4M4 8.5h2.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        <path d="M9 9l1.5 1.5L12 9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M10.5 10.5V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
      </svg>
    </button>
    <button class="delete-btn" title="Delete" aria-label="Delete expense">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
      </svg>
    </button>
  `;
  return li;
}

function deleteExpense(id) {
  const index = expenses.findIndex(e => e.id === id);
  if (index === -1) return;
  const expense = expenses[index];
  debugLog('expense deleted', expense);
  deleteStack.push({ expense, index });
  indexRemove(expense);
  expenses.splice(index, 1);
  save();
  render();
  showToast('Expense deleted', { label: 'Undo', fn: undoDelete });
}

function undoDelete() {
  if (!deleteStack.length) return;
  const { expense, index } = deleteStack.pop();
  debugLog('delete undone', expense);
  expenses.splice(index, 0, expense);
  indexAdd(expense);
  save();
  render();
  if (deleteStack.length) {
    showToast('Expense restored', { label: 'Undo', fn: undoDelete });
  } else {
    showToast('Expense restored');
  }
}

function toggleFavorite(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  debugLog('favorite toggled', { id, favorite: !expense.favorite });
  expense.favorite = !expense.favorite;
  save();
  render();
}

function nextOccurrence(expense) {
  if (!expense.recurrence) return null;
  const next = new Date(expense.date);
  const now = new Date();
  while (next <= now) {
    if (expense.recurrence === 'monthly') next.setMonth(next.getMonth() + 1);
    else if (expense.recurrence === 'weekly') next.setDate(next.getDate() + 7);
    else if (expense.recurrence === 'yearly') next.setFullYear(next.getFullYear() + 1);
    else return null;
  }
  return next;
}

function toggleRecurrence(id) {
  const expense = expenses.find(e => e.id === id);
  if (!expense) return;
  expense.recurrence = expense.recurrence ? null : 'monthly';
  debugLog('recurrence toggled', { id, recurrence: expense.recurrence });
  save();
  render();
}

// --- PDF generation ---
// Produces a minimal but spec-compliant PDF-1.4 document for a single expense receipt.
// Uses only built-in Type1 fonts (Helvetica + Helvetica-Bold) so no font embedding is needed.
// All content is restricted to printable ASCII (\x20-\x7E) so String.length == byte count,
// keeping the xref byte-offset table accurate without a separate encode step.
function generateExpensePDF(expense) {
  function pdfEsc(s) {
    return String(s ?? '')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  const amount = formatCurrency(expense.amount);
  const dateStr = new Date(expense.date).toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const generatedStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // Content stream — PDF coordinates: origin bottom-left, y increases upward
  // F1 = Helvetica (regular), F2 = Helvetica-Bold
  const cs = [];

  cs.push('BT');
  cs.push('/F2 22 Tf');
  cs.push('0.11 0.11 0.11 rg');
  cs.push('1 0 0 1 56 748 Tm');
  cs.push('(Ledger) Tj');
  cs.push('ET');

  cs.push('0.88 0.88 0.87 RG 0.75 w');
  cs.push('56 736 m 556 736 l S');

  cs.push('BT');
  cs.push('0.11 0.11 0.11 rg /F2 32 Tf');
  cs.push('1 0 0 1 56 695 Tm');
  cs.push(`(${pdfEsc(amount)}) Tj`);

  cs.push('0.47 0.44 0.42 rg /F1 10 Tf');
  cs.push('1 0 0 1 56 679 Tm');
  cs.push(`(${pdfEsc(expense.category)}) Tj`);
  cs.push('ET');

  cs.push('0.88 0.88 0.87 RG');
  cs.push('56 667 m 556 667 l S');

  const fields = [
    { label: 'DATE', value: dateStr },
    { label: 'CATEGORY', value: expense.category },
  ];
  if (expense.note) fields.push({ label: 'NOTE', value: expense.note.slice(0, 72) });

  cs.push('BT');
  let fy = 647;
  for (const { label, value } of fields) {
    cs.push('0.47 0.44 0.42 rg /F2 8 Tf');
    cs.push(`1 0 0 1 56 ${fy} Tm`);
    cs.push(`(${pdfEsc(label)}) Tj`);
    cs.push('0.11 0.11 0.11 rg /F1 12 Tf');
    cs.push(`1 0 0 1 56 ${fy - 16} Tm`);
    cs.push(`(${pdfEsc(value)}) Tj`);
    fy -= 48;
  }
  cs.push('ET');

  cs.push('BT');
  cs.push('0.47 0.44 0.42 rg /F1 9 Tf');
  cs.push('1 0 0 1 56 48 Tm');
  cs.push(`(Generated by Ledger on ${pdfEsc(generatedStr)}) Tj`);
  cs.push('ET');

  const stream = cs.join('\n');

  const objs = [
    '1 0 obj\n<</Type/Catalog/Pages 2 0 R>>\nendobj',
    '2 0 obj\n<</Type/Pages/Kids[3 0 R]/Count 1>>\nendobj',
    '3 0 obj\n<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R/F2 6 0 R>>>>>>\nendobj',
    `4 0 obj\n<</Length ${stream.length}>>\nstream\n${stream}\nendstream\nendobj`,
    '5 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>\nendobj',
    '6 0 obj\n<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>\nendobj',
  ];

  let body = '%PDF-1.4\n';
  const offsets = [];
  for (const o of objs) {
    offsets.push(body.length);
    body += o + '\n';
  }

  const xrefPos = body.length;
  let xref = 'xref\n0 7\n0000000000 65535 f \n';
  for (const off of offsets) {
    xref += off.toString().padStart(10, '0') + ' 00000 n \n';
  }
  body += xref;
  body += `trailer\n<</Size 7/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF`;

  return body;
}

// --- CSV Export ---
function exportCSV() {
  if (!expenses.length) {
    showToast('No expenses to export');
    return;
  }

  exportBtn.disabled = true;
  showToast('Preparing export…');

  const worker = new Worker('export.worker.js');

  worker.onmessage = ({ data: { csv, count } }) => {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    exportBtn.disabled = false;
    showToast(`Exported ${count} expense${count !== 1 ? 's' : ''}`);
    worker.terminate();
  };

  worker.onerror = (err) => {
    console.error('Export worker error:', err);
    showToast('Export failed');
    exportBtn.disabled = false;
    worker.terminate();
  };

  // Structured-clone sends a deep copy to the worker — main thread is free immediately
  worker.postMessage(expenses);
}

// --- Storage ---
function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
    showToast('Could not save — storage may be full');
  }
}

// --- Helpers ---
function formatCurrency(n) {
  return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now - d;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + 'm ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + 'h ago';
  if (diff < 604_800_000) return Math.floor(diff / 86_400_000) + 'd ago';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg, action) {
  toast.innerHTML = '';
  toast.appendChild(document.createTextNode(msg));
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-undo';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      clearTimeout(toastTimer);
      toast.classList.remove('show');
      action.fn();
    });
    toast.appendChild(btn);
  }
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), action ? 4000 : 2200);
}
