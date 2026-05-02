const pool = require("../db/pool");

async function getActiveBoosts(discordId) {
  const result = await pool.query(
    `
    SELECT *
    FROM active_boosts
    WHERE discord_id = $1
    AND expires_at > NOW()
    `,
    [discordId]
  );

  return result.rows;
}

async function getEggMultiplier(discordId) {
  const boosts = await getActiveBoosts(discordId);

  let multiplier = 1;

  for (const boost of boosts) {
    if (boost.boost_id === "double_eggs_30m") {
      multiplier *= Number(boost.multiplier || 1);
    }
  }

  return multiplier;
}

async function getLuckMultiplier(discordId) {
  const boosts = await getActiveBoosts(discordId);

  let multiplier = 1;

  for (const boost of boosts) {
    if (boost.boost_id === "luck_boost_30m") {
      multiplier *= Number(boost.multiplier || 1);
    }
  }

  return multiplier;
}

module.exports = {
  getActiveBoosts,
  getEggMultiplier,
  getLuckMultiplier
};