# Ledger

A minimal personal expense tracker that runs entirely in the browser — no backend, no accounts, no setup.

## Features

- Track expenses by amount, category, and note
- See total spent, this month's total, and entry count at a glance
- Filter by category with a live subtotal
- Relative timestamps (just now, 5m ago, 2d ago)
- Data persists in `localStorage` — nothing leaves your device
- Floating action button + slide-up drawer for quick entry

## Categories

Food & Drink, Transport, Housing, Health, Shopping, Entertainment, Utilities, Other

## Usage

Open `index.html` in any modern browser. No build step required.

1. Tap **+** to open the add-expense drawer
2. Enter an amount, pick a category, and optionally add a note
3. Hit **Add Expense** — the list updates instantly
4. Use the category dropdown to filter and see a subtotal
5. Click the **x** on any row to delete it, or **Clear all** to wipe everything

## Stack

Vanilla HTML, CSS, and JavaScript. Zero dependencies.
