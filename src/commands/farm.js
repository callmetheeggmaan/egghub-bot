const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { createGameRoom } = require("../utils/gameRooms");

const {
  getFarm,
  applyOfflineEarnings,
  saveFarm,
  buildFarmEmbed,
  mainButtons,
  registerFarmPanel,
} = require("../systems/farmSystem");

function buildGoToRoomRow(channelUrl) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Go To Generator Room")
      .setStyle(ButtonStyle.Link)
      .setURL(channelUrl)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("farm")
    .setDescription("Open your Origin Generator Room"),

  async execute(interaction) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const roomResult = await createGameRoom(interaction, "farm", {
      publicViewOnly: true,
    });

    const channel = roomResult.channel;

    await interaction.editReply({
      content: roomResult.alreadyExists
        ? `Your Origin Generator Room is already active: ${channel}`
        : `Your Origin Generator Room is ready: ${channel}`,
      components: [buildGoToRoomRow(channel.url)],
    });

    let farm = await getFarm(interaction.user.id);
    const offline = applyOfflineEarnings(farm);
    farm = offline.farm;

    await saveFarm(interaction.user.id, farm);

    const eventText =
      offline.earned >= 1
        ? `Your generators created **${Math.floor(offline.earned).toLocaleString("en-GB")} OC** while running.`
        : "Your Origin Generator Room is humming with black-gold energy.";

    const panelMessage = await channel.send({
      content: `${interaction.user}, your generators are active.`,
      embeds: [buildFarmEmbed(interaction.user, farm, eventText)],
      components: [mainButtons()],
    });

    registerFarmPanel(panelMessage, interaction.user.id, interaction.user.username);
  },
};