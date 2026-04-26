const { SlashCommandBuilder } = require("discord.js");
const pool = require("../db/pool");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your Egg balance"),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;

    try {
      let result = await pool.query(
        "SELECT * FROM users WHERE discord_id = $1",
        [userId]
      );

      if (result.rows.length === 0) {
        await pool.query(
          "INSERT INTO users (discord_id, username, eggs) VALUES ($1, $2, $3)",
          [userId, username, 0]
        );

        return interaction.reply(`🥚 ${username} has 0 Eggs`);
      }

      const eggs = result.rows[0].eggs;

      await interaction.reply(`🥚 ${username} has ${eggs} Eggs`);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Database error",
        ephemeral: true,
      });
    }
  },
};