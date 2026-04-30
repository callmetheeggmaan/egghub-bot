const { SlashCommandBuilder } = require("discord.js");
const { stopMusic } = require("../utils/musicPlayer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stop")
    .setDescription("Stop the music and clear the queue"),

  async execute(interaction) {
    const result = stopMusic(interaction.guild.id);

    if (result.error) {
      return interaction.reply({
        content: `❌ ${result.error}`,
        ephemeral: true,
      });
    }

    return interaction.reply("🛑 Music stopped and queue cleared.");
  },
};