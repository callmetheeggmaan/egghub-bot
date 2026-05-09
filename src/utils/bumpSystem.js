const { EmbedBuilder } = require("discord.js");
const pool = require("../db/pool");

const DISBOARD_BOT_ID = process.env.DISBOARD_BOT_ID || "302050872383242240";
const BUMP_CHANNEL_ID = process.env.BUMP_CHANNEL_ID;
const BUMP_REWARD = Number(process.env.BUMP_REWARD || 500);
const BUMP_INTERVAL_MS = 2 * 60 * 60 * 1000;

let lastBumpAt = 0;
let reminderTimer = null;

function formatOC(amount) {
  return Number(amount || 0).toLocaleString("en-GB");
}

async function rewardUser(userId, username, amount) {
  await pool.query(
    `
    INSERT INTO users (discord_id, username, eggs)
    VALUES ($1, $2, $3)
    ON CONFLICT (discord_id)
    DO UPDATE SET
      eggs = users.eggs + $3,
      username = EXCLUDED.username
    `,
    [userId, username, amount]
  );
}

function buildReminderEmbed() {
  return new EmbedBuilder()
    .setTitle("ORIGIN BUMP READY")
    .setColor(0xd4af37)
    .setDescription(
      `The Origin server is ready to be bumped.\n\n` +
      `Use **/bump** in this channel.\n\n` +
      `Reward: **${formatOC(BUMP_REWARD)} OC**`
    )
    .setFooter({ text: "Origin Growth System" })
    .setTimestamp();
}

function buildRewardEmbed(user) {
  return new EmbedBuilder()
    .setTitle("ORIGIN BUMP REWARDED")
    .setColor(0xd4af37)
    .setDescription(
      `${user} bumped the server and earned **${formatOC(BUMP_REWARD)} OC**.\n\n` +
      `Next bump reminder will appear in around **2 hours**.`
    )
    .setFooter({ text: "Origin Growth System" })
    .setTimestamp();
}

async function sendBumpReminder(client) {
  if (!BUMP_CHANNEL_ID) {
    console.log("BUMP_CHANNEL_ID is not set.");
    return;
  }

  const channel = await client.channels.fetch(BUMP_CHANNEL_ID).catch(() => null);

  if (!channel) {
    console.log("Bump channel not found.");
    return;
  }

  await channel.send({
    embeds: [buildReminderEmbed()],
  });
}

function scheduleNextReminder(client) {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
  }

  reminderTimer = setTimeout(async () => {
    await sendBumpReminder(client);
    scheduleNextReminder(client);
  }, BUMP_INTERVAL_MS);
}

function startBumpSystem(client) {
  console.log("Origin bump reminder system started.");

  scheduleNextReminder(client);

  setTimeout(async () => {
    await sendBumpReminder(client);
  }, 10000);
}

async function handleBumpMessage(message, client) {
  try {
    if (!message.guild) return false;
    if (!message.author?.bot) return false;
    if (message.author.id !== DISBOARD_BOT_ID) return false;

    const content = message.content || "";

    const embedText =
      message.embeds
        ?.map((embed) => {
          return [
            embed.title || "",
            embed.description || "",
            ...(embed.fields || []).map((field) => `${field.name} ${field.value}`),
          ].join(" ");
        })
        .join(" ") || "";

    const combined = `${content} ${embedText}`.toLowerCase();

    const looksLikeBumpSuccess =
      combined.includes("bump done") ||
      combined.includes("bumped") ||
      combined.includes("bump successful") ||
      combined.includes("thanks for bumping") ||
      combined.includes("server bumped");

    if (!looksLikeBumpSuccess) return false;

    const now = Date.now();

    if (now - lastBumpAt < 60 * 1000) {
      return true;
    }

    lastBumpAt = now;

    let bumper = null;

    if (message.interaction?.user) {
      bumper = message.interaction.user;
    }

    if (!bumper && message.mentions?.users?.size > 0) {
      bumper = message.mentions.users.first();
    }

    if (!bumper) {
      await message.channel.send(
        "Bump detected, but I could not identify who bumped. No OC was awarded."
      );

      scheduleNextReminder(client);
      return true;
    }

    await rewardUser(bumper.id, bumper.username, BUMP_REWARD);

    await message.channel.send({
      embeds: [buildRewardEmbed(bumper)],
    });

    scheduleNextReminder(client);

    return true;
  } catch (error) {
    console.error("Bump message handler error:", error);
    return false;
  }
}

module.exports = {
  startBumpSystem,
  handleBumpMessage,
};