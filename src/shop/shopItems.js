const SHOP_ITEMS = [
  {
    id: "double_chips_30m",
    name: "Double Coin Boost",
    emoji: "◆",
    type: "boost",
    category: "boosts",
    description: "Double your Origin Coin earnings for 30 minutes.",
    price: 2500,
    durationMinutes: 30,
    multiplier: 2,
    rarity: "Rare"
  },
  {
    id: "luck_boost_30m",
    name: "Vault Luck Boost",
    emoji: "◇",
    type: "boost",
    category: "boosts",
    description: "Improves your odds in vault cases and reward drops for 30 minutes.",
    price: 4000,
    durationMinutes: 30,
    multiplier: 1.35,
    rarity: "Epic"
  },
  {
    id: "basic_egg_case",
    name: "Bronze Origin Vault",
    emoji: "▣",
    type: "case",
    category: "cases",
    description: "A standard Origin vault with coins, boosts, and exclusive rewards.",
    price: 1500,
    rarity: "Common"
  },
  {
    id: "golden_egg_case",
    name: "Golden Origin Vault",
    emoji: "◆",
    type: "case",
    category: "cases",
    description: "A premium Origin vault with higher payouts and rare rewards.",
    price: 6000,
    rarity: "Legendary"
  },
  {
    id: "egg_hunter_role",
    name: "High Roller Role",
    emoji: "♛",
    type: "role",
    category: "roles",
    description: "Unlock the High Roller Origin status role.",
    price: 10000,
    roleName: "High Roller",
    rarity: "Epic"
  },
  {
    id: "golden_egg_role",
    name: "Origin Elite Role",
    emoji: "♚",
    type: "role",
    category: "roles",
    description: "Unlock the Origin Elite premium status role.",
    price: 25000,
    roleName: "Origin Elite",
    rarity: "Legendary"
  }
];

module.exports = { SHOP_ITEMS };