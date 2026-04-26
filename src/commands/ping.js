const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("eggping")
    .setDescription("Checks if EggHub Bot is online"),

  async execute(interaction) {
    await interaction.reply("EggHub Bot is online.");
  },
};