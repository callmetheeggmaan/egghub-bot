const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { BRAND, formatCurrency, originLine } = require("../config/brand");
const { getJackpot } = require("../utils/jackpot");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("jackpot")
    .setDescription("View the current Origin jackpot."),

  async execute(interaction) {
    const jackpot = await getJackpot();

    const embed = new EmbedBuilder()
      .setTitle(`${BRAND.name} Jackpot`)
      .setDescription(
        [
          originLine(),
          `Current Jackpot: **${formatCurrency(jackpot)}**`,
          "",
          "The jackpot grows as players use Origin systems.",
          "More activity means a larger prize pool.",
          originLine()
        ].join("\n")
      )
      .setColor(BRAND.colour)
      .setFooter({ text: `${BRAND.fullName} • Global Jackpot` });

    return interaction.reply({
      embeds: [embed]
    });
  }
};