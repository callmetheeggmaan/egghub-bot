const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

let activeDrop = null;

const DROP_INTERVAL = 5 * 60 * 1000;
const DROP_EXPIRE_TIME = 60 * 1000;

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

async function spawnDrop(channel) {
  if (activeDrop) return;

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

    const expiredButton = ButtonBuilder.from(button)
      .setLabel("Drop expired")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("⌛")
      .setDisabled(true);

    const expiredRow = new ActionRowBuilder().addComponents(expiredButton);

    await dropMessage.edit({
      content:
        `⌛ **EGG DROP EXPIRED**\n\n` +
        `Nobody claimed the **${reward} Eggs** in time.`,
      components: [expiredRow],
    }).catch(() => null);
  }, DROP_EXPIRE_TIME);
}

function startSmartDrops(client) {
  console.log("Timed Egg Drops started. Drops will run every 5 minutes.");

  setInterval(async () => {
    try {
      if (activeDrop) return;

      const guild = client.guilds.cache.first();
      if (!guild) return;

      const dropChannelId = process.env.DROP_CHANNEL_ID;

      if (!dropChannelId) {
        console.log("DROP_CHANNEL_ID is missing. Egg Drops will not send.");
        return;
      }

      const dropChannel = guild.channels.cache.get(dropChannelId);

      if (!dropChannel) {
        console.log(`DROP_CHANNEL_ID is invalid or bot cannot see it: ${dropChannelId}`);
        return;
      }

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
      ephemeral: true,
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
      ephemeral: true,
    });
    return true;
  }

  activeDrop.claimed = true;

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

  const claimedButton = new ButtonBuilder()
    .setCustomId("drop_claimed")
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
      `Stay active. The next drop will appear soon.`,
    components: [row],
  });

  activeDrop = null;
  return true;
}

module.exports = {
  trackDropActivity,
  startSmartDrops,
  handleDropClaim,
};