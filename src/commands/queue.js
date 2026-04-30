const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { getQueueInfo } = require("../utils/musicPlayer");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("queue")
    .setDescription("Show the current music queue"),

  async execute(interaction) {
    const queue = getQueueInfo(interaction.guild.id);

    if (!queue.current && queue.songs.length === 0) {
      return interaction.reply({
        content: "🎵 The music queue is empty.",
        ephemeral: true,
      });
    }

    const upcoming = queue.songs
      .slice(0, 10)
      .map((song, index) => `**${index + 1}.** ${song.title}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle("🎵 EggHub Music Queue")
      .setDescription(
        `**Now Playing**\n${queue.current ? queue.current.title : "Nothing"}\n\n` +
        `**Up Next**\n${upcoming || "No more songs queued."}`
      );

    return interaction.reply({ embeds: [embed] });
  },
};