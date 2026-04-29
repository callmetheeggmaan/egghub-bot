const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

let activeDrop = null;

const DROP_INTERVAL = 5 * 60 * 1000; // drop every 5 minutes
const DROP_EXPIRE_TIME = 60 * 1000; // unclaimed drop expires after 60 seconds
const CLAIMED_DELETE_DELAY = 10 * 1000; // claimed winner message deletes after 10 seconds
const EXPIRED_DELETE_DELAY = 3 * 1000; // expired message deletes after 3 seconds

function getRandomReward() {
  const rewards = [
    { amount: 10, chance: 35 },
    { amount: 15, chance: 25 },
    { amount: 20, chance: 20 },
    { amount: 50, chance: 12 },
    { amount: 75, chance: 6 },
    { amount: 100, chance: 2 },
  ];

  const roll = Math.random() * 100;
  let total = 0;

  for (const reward of rewards) {
    total += reward.chance;
    if (roll <= total) return reward.amount;
  }

  return 10;
}

function createDropId() {
  return `${Date.now()}${Math.floor(Math.random() * 999999)}`;
}

function trackDropActivity() {
  return;
}

async function getDropChannel(client) {
  const guild = client.guilds.cache.first();

  if (!guild) {
    console.log("Egg Drop error: No guild found.");
    return null;
  }

  const dropChannelId = process.env.DROP_CHANNEL_ID;

  if (!dropChannelId) {
    console.log("Egg Drop error: DROP_CHANNEL_ID is missing.");
    return null;
  }

  const dropChannel = guild.channels.cache.get(dropChannelId);

  if (!dropChannel) {
    console.log(`Egg Drop error: Invalid DROP_CHANNEL_ID or bot cannot see channel: ${dropChannelId}`);
    return null;
  }

  return dropChannel;
}

async function spawnDrop(channel) {
  if (activeDrop) {
    console.log("Egg Drop skipped: active drop already exists.");
    return;
  }

  const reward = getRandomReward();
  const dropId = createDropId();

  const button = new ButtonBuilder()
    .setCustomId(`claimdrop:${dropId}:${reward}`)
    .setLabel(`Claim ${reward} Eggs`)
    .setStyle(ButtonStyle.Success)
    .setEmoji("🥚");

  const row = new ActionRowBuilder().addComponents(button);

  const dropMessage = await channel.send({
    content:
      `🥚 **EGG DROP HAS APPEARED!** 🥚\n\n` +
      `First person to click the button wins **${reward} Eggs**!\n\n` +
      `⏳ You have **60 seconds** to claim it.`,
    components: [row],
  });

  console.log(`Egg Drop spawned in #${channel.name} for ${reward} Eggs.`);

  activeDrop = {
    id: dropId,
    reward,
    messageId: dropMessage.id,
    channelId: channel.id,
    claimed: false,
  };

  setTimeout(async () => {
    if (!activeDrop) return;
    if (activeDrop.id !== dropId) return;
    if (activeDrop.claimed) return;

    activeDrop = null;

    try {
      await dropMessage.edit({
        content: `⌛ Drop expired...`,
        components: [],
      });

      setTimeout(() => {
        dropMessage.delete().catch(() => null);
      }, EXPIRED_DELETE_DELAY);
    } catch (err) {
      console.log("Failed to clean expired drop message:", err.message);
    }
  }, DROP_EXPIRE_TIME);
}

function startSmartDrops(client) {
  console.log("Timed Egg Drops started.");
  console.log("Egg Drops will run every 5 minutes.");

  setInterval(async () => {
    try {
      const dropChannel = await getDropChannel(client);
      if (!dropChannel) return;

      await spawnDrop(dropChannel);
    } catch (error) {
      console.error("Timed drop error:", error);
    }
  }, DROP_INTERVAL);
}

async function handleDropClaim(interaction) {
  if (!interaction.customId.startsWith("claimdrop:")) return false;

  if (!activeDrop) {
    await interaction.reply({
      content: "This drop has already been claimed or expired.",
      flags: 64,
    });
    return true;
  }

  const parts = interaction.customId.split(":");
  const dropId = parts[1];
  const reward = Number(parts[2]);

  if (
    activeDrop.id !== dropId ||
    activeDrop.messageId !== interaction.message.id ||
    activeDrop.claimed
  ) {
    await interaction.reply({
      content: "This drop has already been claimed or expired.",
      flags: 64,
    });
    return true;
  }

  activeDrop.claimed = true;

  const userId = interaction.user.id;
  const username = interaction.user.username;
  const messageToDelete = interaction.message;

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

  const claimedButton = new ButtonBuilder()
    .setCustomId("claimed_drop")
    .setLabel(`Claimed by ${username}`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji("✅")
    .setDisabled(true);

  const row = new ActionRowBuilder().addComponents(claimedButton);

  await interaction.update({
    content:
      `🎉 **EGG DROP CLAIMED!** 🎉\n\n` +
      `${interaction.user} was the quickest to grab it.\n\n` +
      `🥚 **Reward:** ${reward} Eggs\n` +
      `🏆 **Winner:** ${username}\n\n` +
      `This message will delete in 10 seconds.`,
    components: [row],
  });

  activeDrop = null;

  setTimeout(() => {
    messageToDelete.delete().catch((err) => {
      console.log("Failed to delete claimed drop message:", err.message);
    });
  }, CLAIMED_DELETE_DELAY);

  return true;
}

module.exports = {
  trackDropActivity,
  startSmartDrops,
  handleDropClaim,
};