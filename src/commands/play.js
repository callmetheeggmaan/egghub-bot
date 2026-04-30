const { SlashCommandBuilder } = require("discord.js");
const { addSong } = require("../utils/musicPlayer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play music in your voice channel")
    .addStringOption(option =>
      option
        .setName("query")
        .setDescription("Song name or YouTube link")
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("query");

    await interaction.deferReply();

    try {
      const result = await addSong(interaction, query);

      if (result.error) {
        return interaction.editReply(`❌ ${result.error}`);
      }

      return interaction.editReply(
        `✅ **Added to queue**\n**${result.song.title}**\n⏱️ ${result.song.duration}`
      );
    } catch (err) {
      console.error("Play command error:", err);
      return interaction.editReply("❌ Failed to play that song.");
    }
  },
};