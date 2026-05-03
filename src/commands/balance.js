const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const pool = require("../db/pool");
const { BRAND, formatCurrency, originLine } = require("../config/brand");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("balance")
    .setDescription("Check your Origin balance"),

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
          "INSERT INTO users (discord_id, username, eggs) VALUES ($1, $2, $3)",
          [userId, username, 0]
        );
      }

      const balance = result.rows[0]?.eggs || 0;

      const embed = new EmbedBuilder()
        .setTitle(`${BRAND.name} Balance`)
        .setDescription(
          [
            originLine(),
            `**Player:** ${username}`,
            `**Balance:** ${BRAND.currencyEmoji} ${formatCurrency(balance)}`,
            originLine()
          ].join("\n")
        )
        .setColor(BRAND.colour)
        .setFooter({ text: `${BRAND.fullName} • ${BRAND.tagline}` });

      return interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error("Balance error:", error);

      return interaction.reply({
        content: "Balance could not be loaded.",
        ephemeral: true
      });
    }
  }
};