const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

let dropActive = false;

const DROP_INTERVAL = 5 * 60 * 1000; // every 5 minutes
const DROP_EXPIRE_TIME = 60 * 1000; // drop lasts 60 seconds

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

// Kept so bot.js does not break.
// It no longer needs to track messages.
function trackDropActivity(message) {
  return;
}

async function spawnDrop(channel) {
  if (dropActive) return;

  dropActive = true;

  const reward = getRandomReward();

  const button = new ButtonBuilder()
    .setCustomId(`claim_drop_${reward}`)
    .setLabel(`Claim ${reward} Eggs`)
    .setStyle(ButtonStyle.Success)
    .setEmoji("🥚");

  const row = new ActionRowBuilder().addComponents(button);

  const dropMessage = await channel.send({
    content:
      `🥚 **Egg Drop!**\n\n` +
      `A random drop has appeared.\n` +
      `First person to click wins **${reward} Eggs**!`,
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
  console.log("Timed Egg Drops started. Drops will run every 5 minutes.");

  setInterval(async () => {
    try {
      if (dropActive) return;

      const guild = client.guilds.cache.first();

      if (!guild) {
        console.log("No guild found for Egg Drop.");
        return;
      }

      const dropChannel =
        guild.channels.cache.get(process.env.DROP_CHANNEL_ID) ||
        guild.channels.cache.get(process.env.WELCOME_CHANNEL_ID);

      if (!dropChannel) {
        console.log("No drop channel found. Add DROP_CHANNEL_ID in Railway.");
        return;
      }

      await spawnDrop(dropChannel);
    } catch (error) {
      console.error("Timed drop error:", error);
    }
  }, DROP_INTERVAL);
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