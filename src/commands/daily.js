const { SlashCommandBuilder } = require("discord.js");
const pool = require("../db/pool");

const DAILY_AMOUNT = 50;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily Eggs"),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE discord_id = $1",
        [userId]
      );

      if (result.rows.length === 0) {
        await pool.query(
          "INSERT INTO users (discord_id, username, eggs, last_daily) VALUES ($1, $2, $3, NOW())",
          [userId, username, DAILY_AMOUNT]
        );

        return interaction.reply(`🥚 First daily claimed: +${DAILY_AMOUNT} Eggs`);
      }

      const user = result.rows[0];

      if (user.last_daily) {
        const lastDaily = new Date(user.last_daily).getTime();
        const now = Date.now();
        const diff = now - lastDaily;

        if (diff < COOLDOWN_MS) {
          const remaining = COOLDOWN_MS - diff;
          const hours = Math.floor(remaining / (1000 * 60 * 60));
          const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

          return interaction.reply(
            `⏳ Daily already claimed. Try again in ${hours}h ${minutes}m.`
          );
        }
      }

      await pool.query(
        "UPDATE users SET eggs = eggs + $1, last_daily = NOW(), username = $2 WHERE discord_id = $3",
        [DAILY_AMOUNT, username, userId]
      );

      return interaction.reply(`🥚 Daily reward claimed: +${DAILY_AMOUNT} Eggs`);
    } catch (error) {
      console.error("Daily command error:", error);
      return interaction.reply({
        content: "Database error.",
        ephemeral: true,
      });
    }
  },
};