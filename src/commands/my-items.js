const { SlashCommandBuilder } = require("discord.js");
const pool = require("../db/pool");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("my-items")
    .setDescription("View your active items"),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      const result = await pool.query(
        "SELECT * FROM user_roles WHERE discord_id = $1 AND expires_at > NOW()",
        [userId]
      );

      if (result.rows.length === 0) {
        return interaction.reply("You have no active items.");
      }

      let response = "🎒 **Your Active Items**\n\n";

      for (const row of result.rows) {
        const expiresAt = new Date(row.expires_at);
        const now = new Date();

        const diffMs = expiresAt - now;
        const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);

        response += `🥚 Golden Egg Role — expires in ${days}d ${hours}h\n`;
      }

      await interaction.reply(response);

    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Database error",
        ephemeral: true,
      });
    }
  },
};