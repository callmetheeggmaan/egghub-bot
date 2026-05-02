const SHOP_ITEMS = [
  {
    id: "double_chips_30m",
    name: "Double Chips Boost",
    emoji: "🟡",
    type: "boost",
    category: "boosts",
    description: "Earn 2x Yolk Chips for 30 minutes.",
    price: 2500,
    durationMinutes: 30,
    multiplier: 2,
    rarity: "Rare"
  },
  {
    id: "luck_boost_30m",
    name: "Casino Luck Boost",
    emoji: "🍀",
    type: "boost",
    category: "boosts",
    description: "Improves your luck in drops and cases for 30 minutes.",
    price: 4000,
    durationMinutes: 30,
    multiplier: 1.35,
    rarity: "Epic"
  },
  {
    id: "basic_egg_case",
    name: "Bronze Vault Case",
    emoji: "📦",
    type: "case",
    category: "cases",
    description: "A starter casino case with random chip rewards.",
    price: 1500,
    rarity: "Common"
  },
  {
    id: "golden_egg_case",
    name: "Golden Jackpot Case",
    emoji: "💰",
    type: "case",
    category: "cases",
    description: "A premium case with bigger payouts and rare rewards.",
    price: 6000,
    rarity: "Legendary"
  },
  {
    id: "egg_hunter_role",
    name: "High Roller Role",
    emoji: "🎲",
    type: "role",
    category: "roles",
    description: "Unlock the High Roller cosmetic role.",
    price: 10000,
    roleName: "High Roller",
    rarity: "Epic"
  },
  {
    id: "golden_egg_role",
    name: "Jackpot King Role",
    emoji: "👑",
    type: "role",
    category: "roles",
    description: "Unlock the Jackpot King cosmetic role.",
    price: 25000,
    roleName: "Jackpot King",
    rarity: "Legendary"
  }
];

module.exports = { SHOP_ITEMS };