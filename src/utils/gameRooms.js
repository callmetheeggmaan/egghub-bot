const { ChannelType, PermissionsBitField } = require("discord.js");

const GAME_CATEGORY_NAME = process.env.GAME_CATEGORY_NAME || "ORIGIN GAME ROOMS";

function safeChannelName(input) {
  return String(input || "player")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

async function getOrCreateGameCategory(guild) {
  const existingCategory = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildCategory &&
      channel.name.toLowerCase() === GAME_CATEGORY_NAME.toLowerCase()
  );

  if (existingCategory) return existingCategory;

  return guild.channels.create({
    name: GAME_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    reason: "Origin game rooms category created automatically",
  });
}

async function createGameRoom(interaction, gameName = "game") {
  if (!interaction.guild) {
    throw new Error("Game rooms can only be used inside a server.");
  }

  const guild = interaction.guild;
  const userId = interaction.user.id;
  const botMember = guild.members.me;

  const existingRoom = guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.topic === `origin-game-room:${userId}`
  );

  if (existingRoom) {
    return {
      channel: existingRoom,
      alreadyExists: true,
    };
  }

  const category = await getOrCreateGameCategory(guild);

  const cleanGame = safeChannelName(gameName);
  const cleanUser = safeChannelName(interaction.user.username);

  const channel = await guild.channels.create({
    name: `🎰-${cleanGame}-${cleanUser}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `origin-game-room:${userId}`,
    reason: `Temporary Origin ${gameName} room for ${interaction.user.tag}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: userId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.UseApplicationCommands,
        ],
      },
      {
        id: botMember.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.UseApplicationCommands,
        ],
      },
    ],
  });

  return {
    channel,
    alreadyExists: false,
  };
}

function deleteGameRoom(channel, delayMs = 15000) {
  if (!channel) return;

  const channelId = channel.id;
  const client = channel.client;

  setTimeout(async () => {
    try {
      const freshChannel = await client.channels.fetch(channelId).catch(() => null);

      if (!freshChannel) return;

      if (freshChannel.deletable) {
        await freshChannel.delete("Origin game room closed automatically");
      }
    } catch (error) {
      if (error.code === 10003) return;

      console.error("Failed to delete Origin game room:", error);
    }
  }, delayMs);
}

module.exports = {
  createGameRoom,
  deleteGameRoom,
};