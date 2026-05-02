const CURRENCY = {
  name: "Yolk Chips",
  shortName: "Chips",
  emoji: "🟡",
  dbColumn: "eggs"
};

function formatCurrency(amount) {
  return `${CURRENCY.emoji} ${Number(amount || 0).toLocaleString()} ${CURRENCY.shortName}`;
}

module.exports = {
  CURRENCY,
  formatCurrency
};