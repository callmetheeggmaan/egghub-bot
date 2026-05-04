const {
  ChannelType,
  PermissionsBitField,
} = require("discord.js");

const GAME_CATEGORY_NAME = process.env.GAME_CATEGORY_NAME || "ORIGIN GAME ROOMS";

function safeChannelName(input) {
  return String(input || "player")
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 35);
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
    reason: "Origin temporary game room category created automatically",
  });
}

async function createGameRoom(interaction, gameName = "game") {
  if (!interaction.guild) {
    throw new Error("Game rooms can only be created inside a Discord server.");
  }

  const guild = interaction.guild;
  const member = interaction.member;
  const botMember = guild.members.me;

  const userId = interaction.user.id;
  const cleanUsername = safeChannelName(interaction.user.username);
  const cleanGame = safeChannelName(gameName);

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

  const channel = await guild.channels.create({
    name: `🎰-${cleanGame}-${cleanUsername}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `origin-game-room:${userId}`,
    reason: `Temporary Origin ${gameName} room for ${interaction.user.tag}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [
          PermissionsBitField.Flags.ViewChannel,
        ],
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

async function deleteGameRoom(channel, delayMs = 15000) {
  if (!channel || !channel.deletable) return;

  setTimeout(async () => {
    try {
      await channel.delete("Origin temporary game room closed");
    } catch (error) {
      console.error("Failed to delete Origin game room:", error);
    }
  }, delayMs);
}

module.exports = {
  createGameRoom,
  deleteGameRoom,
};