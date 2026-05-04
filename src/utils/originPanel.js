const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const pool = require("../db/pool");
const { BRAND, formatCurrency, originLine } = require("../config/brand");
const { getJackpot } = require("./jackpot");
const { getNextDropCountdown } = require("./randomDrops");

let panelMessageId = null;

const UPDATE_MS = 60 * 1000;

async function getPanelStats() {
  const users = await pool.query("SELECT COUNT(*) FROM users");
  const economy = await pool.query("SELECT COALESCE(SUM(eggs), 0) AS total FROM users");
  const topPlayer = await pool.query(
    "SELECT username, eggs FROM users ORDER BY eggs DESC LIMIT 1"
  );

  const jackpot = await getJackpot();

  return {
    totalPlayers: Number(users.rows[0]?.count || 0),
    totalCoins: Number(economy.rows[0]?.total || 0),
    topPlayer: topPlayer.rows[0] || null,
    jackpot
  };
}

function buildPanelEmbed(stats) {
  const topPlayerText = stats.topPlayer
    ? `${stats.topPlayer.username} — ${formatCurrency(stats.topPlayer.eggs)}`
    : "No leader yet";

  return new EmbedBuilder()
    .setTitle(`${BRAND.name} Control Panel`)
    .setDescription(
      [
        originLine(),
        `**${BRAND.tagline}**`,
        "",
        "**Live Status**",
        `Players: **${stats.totalPlayers}**`,
        `Coins in Circulation: **${formatCurrency(stats.totalCoins)}**`,
        `Origin Jackpot: **${formatCurrency(stats.jackpot)}**`,
        `Top Player: **${topPlayerText}**`,
        `Next Drop: **${getNextDropCountdown()}**`,
        "",
        "**Systems**",
        "Vault Shop • Vault Opening • Balance • Rules • Leaderboard • Jackpot",
        originLine()
      ].join("\n")
    )
    .setColor(BRAND.colour)
    .setFooter({ text: `${BRAND.fullName} • Live panel updates every 60 seconds` });
}

function buildPanelButtons() {
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

  return [row];
}

async function postOrUpdateOriginPanel(channel) {
  const stats = await getPanelStats();

  if (panelMessageId) {
    const existing = await channel.messages.fetch(panelMessageId).catch(() => null);

    if (existing) {
      await existing.edit({
        embeds: [buildPanelEmbed(stats)],
        components: buildPanelButtons()
      });

      return existing;
    }
  }

  const messages = await channel.messages.fetch({ limit: 20 });

  const existingPanel = messages.find((message) =>
    message.author?.bot &&
    message.embeds?.[0]?.title?.includes(`${BRAND.name} Control Panel`)
  );

  if (existingPanel) {
    panelMessageId = existingPanel.id;

    await existingPanel.edit({
      embeds: [buildPanelEmbed(stats)],
      components: buildPanelButtons()
    });

    return existingPanel;
  }

  const sent = await channel.send({
    embeds: [buildPanelEmbed(stats)],
    components: buildPanelButtons()
  });

  panelMessageId = sent.id;
  return sent;
}

async function startOriginPanel(client) {
  const channelId = process.env.ORIGIN_PANEL_CHANNEL_ID;

  if (!channelId) {
    console.log("ORIGIN_PANEL_CHANNEL_ID missing. Origin panel disabled.");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    console.log("Origin panel channel not found.");
    return;
  }

  await postOrUpdateOriginPanel(channel);

  setInterval(async () => {
    try {
      await postOrUpdateOriginPanel(channel);
    } catch (error) {
      console.error("Origin panel update error:", error);
    }
  }, UPDATE_MS);

  console.log("Origin live panel started.");
}

module.exports = {
  startOriginPanel,
  postOrUpdateOriginPanel
};