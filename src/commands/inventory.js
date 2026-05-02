const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const pool = require("../db/pool");

function getItemEmoji(itemType) {
  if (itemType === "case") return "📦";
  if (itemType === "role") return "🎭";
  if (itemType === "boost") return "⚡";
  return "🎁";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your EggHub inventory."),

  async execute(interaction) {
    const discordId = interaction.user.id;

    try {
      const result = await pool.query(
        `
        SELECT *
        FROM user_inventory
        WHERE discord_id = $1
        ORDER BY item_type ASC, item_name ASC
        `,
        [discordId]
      );

      if (result.rows.length === 0) {
        return interaction.reply({
          content: "📦 Your inventory is empty. Buy cases or rewards from `/shop`.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("📦 Your EggHub Inventory")
        .setDescription("Everything you currently own.")
        .setColor(0xffd700)
        .setFooter({ text: "Use /open to open loot cases" });

      for (const item of result.rows) {
        embed.addFields({
          name: `${getItemEmoji(item.item_type)} ${item.item_name}`,
          value: `Quantity: **${item.quantity}**\nType: **${item.item_type}**`,
          inline: true
        });
      }

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    } catch (error) {
      console.error("Inventory error:", error);

      return interaction.reply({
        content: "❌ Failed to load your inventory.",
        ephemeral: true
      });
    }
  }
};