require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("./db/pool");
const roleExpiry = require("./utils/roleExpiry");
const buyItem = require("./utils/buyItem");
const startLiveLeaderboard = require("./utils/liveLeaderboard");
const { startRandomDrops } = require("./utils/randomDrops");
const { getEggMultiplier } = require("./utils/boosts");
const { formatCurrency } = require("./config/currency");

const {
  trackDropActivity,
  handleDropClaim,
} = require("./utils/randomDrop");

const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  Partials,
} = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.commands = new Collection();

function getLogChannel(guild) {
  if (!process.env.LOG_CHANNEL_ID) return null;
  return guild.channels.cache.get(process.env.LOG_CHANNEL_ID) || null;
}

// Load commands
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs
  .readdirSync(commandsPath)
  .filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);

  if ("data" in command && "execute" in command) {
    client.commands.set(command.data.name, command);
  }
}

// Ready
client.once(Events.ClientReady, () => {
  console.log(`EggHub Casino Bot is online as ${client.user.tag}`);

  roleExpiry(client);
  startLiveLeaderboard(client);

  // New 4-hour casino jackpot drops
  startRandomDrops(client);

  // Old smart drops disabled so drops are not spammed every few minutes.
  // startSmartDrops(client);
});

// Welcome system
client.on(Events.GuildMemberAdd, async (member) => {
  try {
    const welcomeChannel = member.guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);
    const starterRole = member.guild.roles.cache.get(process.env.STARTER_ROLE_ID);
    const logChannel = getLogChannel(member.guild);

    if (starterRole) await member.roles.add(starterRole);

    if (welcomeChannel) {
      await welcomeChannel.send(
        `🎰 Welcome to EggHub Casino, ${member}!\n\nPick your roles with /roles and start earning Yolk Chips.`
      );
    }

    if (logChannel) {
      await logChannel.send(`✅ **Member Joined:** ${member.user.tag} (${member.id})`);
    }

    await pool.query(
      `
      INSERT INTO users (discord_id, username, eggs)
      VALUES ($1, $2, 0)
      ON CONFLICT (discord_id)
      DO UPDATE SET username = EXCLUDED.username
      `,
      [member.user.id, member.user.username]
    );
  } catch (err) {
    console.error("Welcome error:", err);
  }
});

// Leave logs
client.on(Events.GuildMemberRemove, async (member) => {
  try {
    const logChannel = getLogChannel(member.guild);
    if (!logChannel) return;

    await logChannel.send(`❌ **Member Left:** ${member.user.tag} (${member.id})`);
  } catch (err) {
    console.error("Leave log error:", err);
  }
});

// Deleted message logs
client.on(Events.MessageDelete, async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const logChannel = getLogChannel(message.guild);
    if (!logChannel) return;

    const author = message.author
      ? `${message.author.tag} (${message.author.id})`
      : "Unknown user";

    const content = message.content || "[No text content / embed / attachment]";

    await logChannel.send(
      `🗑️ **Message Deleted**\n` +
      `**User:** ${author}\n` +
      `**Channel:** <#${message.channel.id}>\n` +
      `**Message:** ${content.slice(0, 1500)}`
    );
  } catch (err) {
    console.error("Delete log error:", err);
  }
});

// Edited message logs
client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  try {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    const oldContent = oldMessage.content || "";
    const newContent = newMessage.content || "";

    if (oldContent === newContent) return;

    const logChannel = getLogChannel(newMessage.guild);
    if (!logChannel) return;

    await logChannel.send(
      `✏️ **Message Edited**\n` +
      `**User:** ${newMessage.author.tag} (${newMessage.author.id})\n` +
      `**Channel:** <#${newMessage.channel.id}>\n` +
      `**Before:** ${oldContent.slice(0, 700) || "[empty]"}\n` +
      `**After:** ${newContent.slice(0, 700) || "[empty]"}`
    );
  } catch (err) {
    console.error("Edit log error:", err);
  }
});

// Interaction handler
client.on(Events.InteractionCreate, async (interaction) => {
  // Old randomDrop claim button support
  if (interaction.isButton()) {
    const handled = await handleDropClaim(interaction);
    if (handled) return;
  }

  // Role selector
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "role_select") {
      const rolesMap = {
        streamer: process.env.ROLE_STREAMER,
        content_creator: process.env.ROLE_CONTENT_CREATOR,
        artist: process.env.ROLE_ARTIST,
        viewer: process.env.ROLE_VIEWER,
      };

      const member = await interaction.guild.members.fetch(interaction.user.id);

      for (const key in rolesMap) {
        const roleId = rolesMap[key];
        if (!roleId) continue;

        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;

        if (interaction.values.includes(key)) {
          await member.roles.add(role).catch(() => null);
        } else {
          await member.roles.remove(role).catch(() => null);
        }
      }

      return interaction.reply({
        content: "✅ Roles updated",
        ephemeral: true,
      });
    }

    // Old shop select support
    if (interaction.customId === "shop_select") {
      const selected = interaction.values[0];
      return buyItem(interaction, selected);
    }
  }

  // Slash commands
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);

  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error("Command error:", error);

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "Error executing command",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "Error executing command",
        ephemeral: true,
      });
    }
  }
});

// Chat earn system + activity tracking
const messageCooldowns = new Map();

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // Keeps old activity tracker working, but old smart drops are disabled above.
  trackDropActivity(message);

  const userId = message.author.id;
  const username = message.author.username;
  const now = Date.now();

  const last = messageCooldowns.get(userId) || 0;
  if (now - last < 60000) return;

  messageCooldowns.set(userId, now);

  try {
    const baseReward = 2;
    const multiplier = await getEggMultiplier(userId);
    const finalReward = Math.floor(baseReward * multiplier);

    await pool.query(
      `
      INSERT INTO users (discord_id, username, eggs)
      VALUES ($1, $2, $3)
      ON CONFLICT (discord_id)
      DO UPDATE SET
        eggs = users.eggs + $3,
        username = EXCLUDED.username
      `,
      [userId, username, finalReward]
    );

    console.log(`${username} earned ${formatCurrency(finalReward)}`);
  } catch (err) {
    console.error("Chat earn error:", err);
  }
});

client.login(process.env.DISCORD_TOKEN);