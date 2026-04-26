const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("View the EggHub shop"),

  async execute(interaction) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("shop_select")
      .setPlaceholder("Choose an item to buy")
      .addOptions([
        {
          label: "Golden Egg Role",
          description: "1000 Eggs - 7-day role access",
          value: "golden",
        },
        {
          label: "Mystery Egg",
          description: "120 Eggs - random Egg reward",
          value: "mystery",
        },
      ]);

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
      content:
        "🥚 **EggHub Shop**\n\n" +
        "**Golden Egg Role** — 1000 Eggs\n" +
        "**Mystery Egg** — 120 Eggs\n\n" +
        "Select an item below:",
      components: [row],
    });
  },
};