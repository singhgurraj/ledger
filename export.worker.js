self.onmessage = function ({ data: expenses }) {
  const header = ['Date', 'Amount', 'Category', 'Note'];
  const lines = [header.join(',')];

  for (const e of expenses) {
    lines.push([
      new Date(e.date).toISOString(),
      e.amount.toFixed(2),
      csvCell(e.category),
      csvCell(e.note),
    ].join(','));
  }

  self.postMessage({ csv: lines.join('\r\n'), count: expenses.length });
};

function csvCell(val) {
  if (!val) return '';
  const str = String(val);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}
