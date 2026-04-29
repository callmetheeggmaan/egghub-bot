const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

let dropActive = false;
let lastDropTime = 0;
let messageCount = 0;

const DROP_CHECK_INTERVAL = 5 * 60 * 1000; // checks every 5 minutes
const DROP_EXPIRE_TIME = 60 * 1000; // drop lasts 60 seconds
const MIN_MESSAGES_FOR_DROP = 5; // minimum chat activity needed
const MAX_DROP_CHANCE = 0.85; // max 85% chance

function getRandomReward() {
  const rewards = [
    { amount: 10, chance: 35 },
    { amount: 15, chance: 25 },
    { amount: 25, chance: 20 },
    { amount: 50, chance: 12 },
    { amount: 75, chance: 6 },
    { amount: 100, chance: 2 },
  ];

  const roll = Math.random() * 100;
  let total = 0;

  for (const reward of rewards) {
    total += reward.chance;
    if (roll <= total) {
      return reward.amount;
    }
  }

  return 10;
}

function trackDropActivity(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  messageCount += 1;
}

async function spawnDrop(channel) {
  if (dropActive) return;

  dropActive = true;
  lastDropTime = Date.now();

  const reward = getRandomReward();

  const button = new ButtonBuilder()
    .setCustomId(`claim_drop_${reward}`)
    .setLabel(`Claim ${reward} Eggs`)
    .setStyle(ButtonStyle.Success)
    .setEmoji("🥚");

  const row = new ActionRowBuilder().addComponents(button);

  const dropMessage = await channel.send({
    content: `🥚 **Smart Egg Drop!**\nChat activity triggered a drop!\nFirst person to click wins **${reward} Eggs**!`,
    components: [row],
  });

  setTimeout(async () => {
    if (!dropActive) return;

    dropActive = false;

    const disabledButton = ButtonBuilder.from(button).setDisabled(true);
    const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

    await dropMessage.edit({
      content: `⌛ **Egg Drop expired!** Nobody claimed it.`,
      components: [disabledRow],
    }).catch(() => null);
  }, DROP_EXPIRE_TIME);
}

function startSmartDrops(client) {
  setInterval(async () => {
    try {
      if (dropActive) {
        messageCount = 0;
        return;
      }

      const now = Date.now();

      if (now - lastDropTime < DROP_CHECK_INTERVAL) {
        messageCount = 0;
        return;
      }

      if (messageCount < MIN_MESSAGES_FOR_DROP) {
        messageCount = 0;
        return;
      }

      const chance = Math.min(
        messageCount / 25,
        MAX_DROP_CHANCE
      );

      const roll = Math.random();

      const guild = client.guilds.cache.first();
      if (!guild) {
        messageCount = 0;
        return;
      }

      const dropChannel =
        guild.channels.cache.get(process.env.DROP_CHANNEL_ID) ||
        guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);

      if (!dropChannel) {
        console.log("No drop channel found. Add DROP_CHANNEL_ID or WELCOME_CHANNEL_ID.");
        messageCount = 0;
        return;
      }

      if (roll <= chance) {
        await spawnDrop(dropChannel);
      }

      messageCount = 0;
    } catch (error) {
      console.error("Smart drop error:", error);
      messageCount = 0;
    }
  }, DROP_CHECK_INTERVAL);
}

async function handleDropClaim(interaction) {
  if (!interaction.customId.startsWith("claim_drop_")) return false;

  if (!dropActive) {
    await interaction.reply({
      content: "This drop has already been claimed or expired.",
      ephemeral: true,
    });
    return true;
  }

  dropActive = false;

  const reward = Number(interaction.customId.replace("claim_drop_", ""));
  const userId = interaction.user.id;
  const username = interaction.user.username;

  await pool.query(
    `
    INSERT INTO users (discord_id, username, eggs)
    VALUES ($1, $2, $3)
    ON CONFLICT (discord_id)
    DO UPDATE SET
      eggs = users.eggs + $3,
      username = EXCLUDED.username
    `,
    [userId, username, reward]
  );

  const button = new ButtonBuilder()
    .setCustomId("claimed_drop")
    .setLabel(`Claimed by ${username}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("✅")
    .setDisabled(true);

  const row = new ActionRowBuilder().addComponents(button);

  await interaction.update({
    content: `🥚 **Egg Drop Claimed!**\n${interaction.user} won **${reward} Eggs**!`,
    components: [row],
  });

  return true;
}

module.exports = {
  trackDropActivity,
  startSmartDrops,
  handleDropClaim,
};