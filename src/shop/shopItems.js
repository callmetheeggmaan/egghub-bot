const SHOP_ITEMS = [
  {
    id: "double_eggs_30m",
    name: "Double Eggs Boost",
    emoji: "🥚",
    type: "boost",
    category: "boosts",
    description: "Earn 2x Eggs for 30 minutes.",
    price: 500,
    durationMinutes: 30,
    multiplier: 2
  },
  {
    id: "luck_boost_30m",
    name: "Luck Boost",
    emoji: "🍀",
    type: "boost",
    category: "boosts",
    description: "Improves your luck for drops and future cases for 30 minutes.",
    price: 750,
    durationMinutes: 30,
    multiplier: 1.25
  },
  {
    id: "basic_egg_case",
    name: "Basic Egg Case",
    emoji: "📦",
    type: "case",
    category: "cases",
    description: "A starter loot box with random rewards.",
    price: 300
  },
  {
    id: "golden_egg_case",
    name: "Golden Egg Case",
    emoji: "💰",
    type: "case",
    category: "cases",
    description: "A better loot box with higher-value rewards.",
    price: 1000
  },
  {
    id: "egg_hunter_role",
    name: "Egg Hunter Role",
    emoji: "🏹",
    type: "role",
    category: "roles",
    description: "Unlock the Egg Hunter cosmetic role.",
    price: 1500,
    roleName: "Egg Hunter"
  },
  {
    id: "golden_egg_role",
    name: "Golden Egg Role",
    emoji: "👑",
    type: "role",
    category: "roles",
    description: "Unlock the Golden Egg cosmetic role.",
    price: 5000,
    roleName: "Golden Egg"
  }
];

module.exports = { SHOP_ITEMS };