const { SlashCommandBuilder } = require("discord.js");
const { skipSong } = require("../utils/musicPlayer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("skip")
    .setDescription("Skip the current song"),

  async execute(interaction) {
    const result = skipSong(interaction.guild.id);

    if (result.error) {
      return interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
    }

    return interaction.reply("⏭️ Skipped.");
  },
};