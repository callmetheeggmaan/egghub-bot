const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits
} = require("discord.js");

const { BRAND, originLine } = require("../config/brand");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("originpanel")
    .setDescription("Post the Origin control panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle(`${BRAND.name} Control Panel`)
      .setDescription(
        [
          originLine(),
          `**${BRAND.tagline}**`,
          "",
          "Use this panel to access the main Origin systems.",
          "",
          "**Available Systems**",
          "• Vault Shop",
          "• Vault Opening",
          "• Balance",
          "• Rules",
          "• Leaderboard",
          originLine()
        ].join("\n")
      )
      .setColor(BRAND.colour)
      .setFooter({ text: `${BRAND.fullName} • Control Panel` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("origin_panel_rules")
        .setLabel("Rules")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("origin_panel_shop")
        .setLabel("Shop")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("origin_panel_open")
        .setLabel("Open Vaults")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId("origin_panel_balance")
        .setLabel("Balance")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("origin_panel_leaderboard")
        .setLabel("Leaderboard")
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.channel.send({
      embeds: [embed],
      components: [row]
    });

    return interaction.reply({
      content: "Origin Control Panel posted.",
      ephemeral: true
    });
  }
};