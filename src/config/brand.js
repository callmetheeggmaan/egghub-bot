const BRAND = {
  name: "Origin",
  fullName: "Origin Casino",
  tagline: "Built From The Beginning",

  colour: 0xd4af37,
  darkColour: 0x050505,

  currencyName: "Origin Coins",
  currencyShort: "OC",
  currencyEmoji: "🟡"
};

function formatCurrency(amount) {
  return `${Number(amount || 0).toLocaleString()} ${BRAND.currencyShort}`;
}

function originLine() {
  return "━━━━━━━━━━━━━━━━━━";
}

module.exports = {
  BRAND,
  formatCurrency,
  originLine
};