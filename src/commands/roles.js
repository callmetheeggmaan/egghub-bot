const {
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roles")
    .setDescription("Select your roles"),

  async execute(interaction) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("role_select")
      .setPlaceholder("Choose your roles")
      .setMinValues(1)
      .setMaxValues(4)
      .addOptions([
        {
          label: "Streamer",
          description: "I stream content",
          value: "streamer",
        },
        {
          label: "Content Creator",
          description: "I create content",
          value: "content_creator",
        },
        {
          label: "Artist",
          description: "I create art/designs",
          value: "artist",
        },
        {
          label: "Viewer",
          description: "I watch and support",
          value: "viewer",
        },
      ]);

    const row = new ActionRowBuilder().addComponents(select);

    await interaction.reply({
      content: "🎭 Select your roles below:",
      components: [row],
    });
  },
};