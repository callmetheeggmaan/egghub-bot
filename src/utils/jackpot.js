const pool = require("../db/pool");

async function ensureJackpot() {
  await pool.query(
    `
    INSERT INTO jackpot_state (id, amount)
    VALUES (1, 100000)
    ON CONFLICT (id) DO NOTHING
    `
  );
}

async function getJackpot() {
  await ensureJackpot();

  const result = await pool.query(
    "SELECT amount FROM jackpot_state WHERE id = 1"
  );

  return Number(result.rows[0]?.amount || 0);
}

async function addToJackpot(amount, discordId = null, username = null, action = "add") {
  await ensureJackpot();

  const safeAmount = Math.max(0, Math.floor(Number(amount || 0)));

  if (safeAmount <= 0) return getJackpot();

  const result = await pool.query(
    `
    UPDATE jackpot_state
    SET amount = amount + $1,
        updated_at = NOW()
    WHERE id = 1
    RETURNING amount
    `,
    [safeAmount]
  );

  await pool.query(
    `
    INSERT INTO jackpot_logs (discord_id, username, action, amount)
    VALUES ($1, $2, $3, $4)
    `,
    [discordId, username, action, safeAmount]
  );

  return Number(result.rows[0]?.amount || 0);
}

async function resetJackpot(newAmount = 100000) {
  await ensureJackpot();

  const amount = Math.max(0, Math.floor(Number(newAmount || 0)));

  await pool.query(
    `
    UPDATE jackpot_state
    SET amount = $1,
        updated_at = NOW()
    WHERE id = 1
    `,
    [amount]
  );

  return amount;
}

async function payJackpot(discordId, username) {
  await ensureJackpot();

  const currentAmount = await getJackpot();

  if (currentAmount <= 0) return 0;

  await pool.query(
    `
    UPDATE users
    SET eggs = eggs + $1,
        username = $2
    WHERE discord_id = $3
    `,
    [currentAmount, username, discordId]
  );

  await pool.query(
    `
    INSERT INTO jackpot_logs (discord_id, username, action, amount)
    VALUES ($1, $2, $3, $4)
    `,
    [discordId, username, "win", currentAmount]
  );

  await resetJackpot(100000);

  return currentAmount;
}

async function rollJackpotWin(chancePercent = 0.25) {
  const roll = Math.random() * 100;
  return roll <= chancePercent;
}

module.exports = {
  ensureJackpot,
  getJackpot,
  addToJackpot,
  resetJackpot,
  payJackpot,
  rollJackpotWin
};