const STORAGE_KEY = 'ledger_expenses';

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

// --- DOM refs ---
const form = document.getElementById('expense-form');
const amountInput = document.getElementById('amount');
const categoryInput = document.getElementById('category');
const noteInput = document.getElementById('note');
const list = document.getElementById('expense-list');
const emptyState = document.getElementById('empty-state');
const totalEl = document.getElementById('total');
const monthTotalEl = document.getElementById('month-total');
const countEl = document.getElementById('count');
const filterSelect = document.getElementById('filter-category');
const clearBtn = document.getElementById('clear-all');
const toast = document.getElementById('toast');

// --- Init ---
render();

// --- Events ---
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = parseFloat(amountInput.value);
  if (!amount || amount <= 0) return;

  const expense = {
    id: crypto.randomUUID(),
    amount,
    category: categoryInput.value,
    note: noteInput.value.trim(),
    date: new Date().toISOString(),
  };

  expenses.unshift(expense);
  save();
  render();
  form.reset();
  categoryInput.value = '';
  amountInput.focus();
  showToast('Expense added');
});

filterSelect.addEventListener('change', render);

clearBtn.addEventListener('click', () => {
  if (!expenses.length) return;
  if (!confirm('Delete all expenses? This cannot be undone.')) return;
  expenses = [];
  save();
  render();
  showToast('All expenses cleared');
});

// --- Core ---
function render() {
  const filter = filterSelect.value;
  const filtered = filter ? expenses.filter(e => e.category === filter) : expenses;

  // Summary always uses all expenses, not filtered
  const now = new Date();
  const thisMonth = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  totalEl.textContent = fmt(expenses.reduce((s, e) => s + e.amount, 0));
  monthTotalEl.textContent = fmt(thisMonth.reduce((s, e) => s + e.amount, 0));
  countEl.textContent = expenses.length;

  list.innerHTML = '';

  if (!filtered.length) {
    const li = document.createElement('li');
    li.className = 'empty-state';
    li.textContent = filter ? 'No expenses in this category.' : 'No expenses yet. Add one above.';
    list.appendChild(li);
    return;
  }

  filtered.forEach(expense => {
    const li = document.createElement('li');
    li.className = 'expense-item';
    li.dataset.id = expense.id;

    const emoji = CATEGORY_EMOJI[expense.category] ?? '📦';
    const dateStr = formatDate(expense.date);

    li.innerHTML = `
      <div class="category-badge" title="${expense.category}">${emoji}</div>
      <div class="item-body">
        <div class="item-top">
          <span class="item-category">${expense.category}</span>
          <span class="item-amount">${fmt(expense.amount)}</span>
        </div>
        <div class="item-meta">
          ${expense.note ? `<span class="item-note" title="${escape(expense.note)}">${escape(expense.note)}</span>` : ''}
          <span class="item-date">${dateStr}</span>
        </div>
      </div>
      <button class="delete-btn" title="Delete" aria-label="Delete expense">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
    `;

    li.querySelector('.delete-btn').addEventListener('click', () => deleteExpense(expense.id));
    list.appendChild(li);
  });
}

function deleteExpense(id) {
  expenses = expenses.filter(e => e.id !== id);
  save();
  render();
  showToast('Expense deleted');
}

// --- Storage ---
function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? [];
  } catch {
    return [];
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses));
}

// --- Helpers ---
function fmt(n) {
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

function escape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let toastTimer;
function showToast(msg) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}
