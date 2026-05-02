const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const pool = require("../db/pool");
const { formatCurrency } = require("../config/currency");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your Yolk Chips balance"),

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

        const embed = new EmbedBuilder()
          .setTitle("🎰 Casino Balance")
          .setDescription(`**${username}** has ${formatCurrency(0)}`)
          .setColor(0xffd700);

        return interaction.reply({ embeds: [embed] });
      }

      const chips = result.rows[0].eggs;

      const embed = new EmbedBuilder()
        .setTitle("🎰 Casino Balance")
        .setDescription(`**${username}** has ${formatCurrency(chips)}`)
        .setColor(0xffd700);

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);

      await interaction.reply({
        content: "Database error",
        ephemeral: true
      });
    }
  }
};