const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const pool = require("../db/pool");
const { BRAND, originLine } = require("../config/brand");

function getItemIcon(itemType) {
  if (itemType === "case") return "▣";
  if (itemType === "role") return "♛";
  if (itemType === "boost") return "◆";
  return "◇";
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("inventory")
    .setDescription("View your Origin inventory."),

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
          content: "Your Origin inventory is empty. Visit `/shop` to open the Vault.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`${BRAND.name} Inventory`)
        .setDescription(
          [
            originLine(),
            "Your owned boosts, vaults, and status rewards.",
            originLine()
          ].join("\n")
        )
        .setColor(BRAND.colour)
        .setFooter({ text: `${BRAND.fullName} • Inventory` });

      for (const item of result.rows) {
        embed.addFields({
          name: `${getItemIcon(item.item_type)} ${item.item_name}`,
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
        content: "Inventory could not be loaded.",
        ephemeral: true
      });
    }
  }
};