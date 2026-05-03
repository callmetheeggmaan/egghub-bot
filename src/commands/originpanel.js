const {
  SlashCommandBuilder,
  PermissionFlagsBits
} = require("discord.js");

const { postOrUpdateOriginPanel } = require("../utils/originPanel");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("originpanel")
    .setDescription("Post or refresh the Origin live control panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    await postOrUpdateOriginPanel(interaction.channel);

    return interaction.reply({
      content: "Origin live control panel posted/refreshed.",
      ephemeral: true
    });
  }
};