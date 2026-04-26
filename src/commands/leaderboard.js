const { SlashCommandBuilder } = require("discord.js");
const pool = require("../db/pool");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("View top Egg holders"),

  async execute(interaction) {
    try {
      const result = await pool.query(
        "SELECT username, eggs FROM users ORDER BY eggs DESC LIMIT 10"
      );

      if (result.rows.length === 0) {
        return interaction.reply("No users found.");
      }

      let leaderboard = "🏆 **EggHub Leaderboard** 🏆\n\n";

      result.rows.forEach((user, index) => {
        leaderboard += `**${index + 1}.** ${user.username} — 🥚 ${user.eggs}\n`;
      });

      await interaction.reply(leaderboard);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Database error",
        ephemeral: true,
      });
    }
  },
};