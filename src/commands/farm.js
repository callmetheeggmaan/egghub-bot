const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { Pool } = require("pg");
const { createGameRoom, deleteGameRoom } = require("../utils/gameRooms");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const TICK_MS = 3000;

const RATES = {
  egg: 50 / 3600,
  miner: 200 / 3600,
  printer: 1000 / 3600,
};

async function ensureFarm(userId) {
  await pool.query(`
    INSERT INTO generators (discord_id)
    VALUES ($1)
    ON CONFLICT (discord_id) DO NOTHING
  `, [userId]);
}

async function getFarm(userId) {
  await ensureFarm(userId);

  const res = await pool.query(
    `SELECT * FROM generators WHERE discord_id = $1`,
    [userId]
  );

  return res.rows[0];
}

async function updateFarm(userId, data) {
  await pool.query(
    `UPDATE generators
     SET stored_oc = $2,
         last_update = NOW()
     WHERE discord_id = $1`,
    [userId, data.stored_oc]
  );
}

function buildEmbed(user, farm, liveGain) {
  return new EmbedBuilder()
    .setTitle("ORIGIN FARM")
    .setColor(0xd4af37)
    .setDescription(
      `🌱 Egg Farms: **${farm.egg_farm}**\n` +
      `⛏️ Miners: **${farm.crypto_miner}**\n` +
      `🏭 Printers: **${farm.vault_printer}**\n\n` +
      `💰 Stored OC: **${Math.floor(farm.stored_oc)}**\n\n` +
      `⚡ Live Gain: +${liveGain} OC`
    )
    .setFooter({ text: "Origin Passive System" });
}

function buildButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("collect")
      .setLabel("Collect")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("upgrade")
      .setLabel("Upgrade")
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId("close")
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("farm")
    .setDescription("Open your Origin Farm"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userId = interaction.user.id;

    const roomResult = await createGameRoom(interaction, "farm");

    if (roomResult.alreadyExists) {
      return interaction.editReply({
        content: `You already have an active farm: ${roomResult.channel}`,
      });
    }

    const channel = roomResult.channel;

    await interaction.editReply({
      content: `Your farm is ready: ${channel}`,
    });

    let farm = await getFarm(userId);

    let panel = await channel.send({
      content: `${interaction.user}, your farm is booting up...`,
    });

    let running = true;

    let interval = setInterval(async () => {
      if (!running) return;

      let gain =
        farm.egg_farm * RATES.egg * (TICK_MS / 1000) +
        farm.crypto_miner * RATES.miner * (TICK_MS / 1000) +
        farm.vault_printer * RATES.printer * (TICK_MS / 1000);

      farm.stored_oc += gain;

      await panel.edit({
        embeds: [buildEmbed(interaction.user, farm, gain.toFixed(2))],
        components: [buildButtons()],
      });
    }, TICK_MS);

    const collector = panel.createMessageComponentCollector({
      time: 120000,
    });

    collector.on("collect", async (i) => {
      if (i.user.id !== userId) {
        return i.reply({
          content: "Not your farm.",
          ephemeral: true,
        });
      }

      if (i.customId === "collect") {
        const amount = Math.floor(farm.stored_oc);

        farm.stored_oc = 0;

        await pool.query(
          `UPDATE users SET eggs = eggs + $2 WHERE discord_id = $1`,
          [userId, amount]
        );

        await i.reply({
          content: `Collected **${amount} OC**`,
          ephemeral: true,
        });
      }

      if (i.customId === "upgrade") {
        await i.reply({
          content:
            "Upgrade coming next step (we’ll make this insane 🔥)",
          ephemeral: true,
        });
      }

      if (i.customId === "close") {
        running = false;
        clearInterval(interval);

        await i.update({
          content: "Closing farm...",
          embeds: [],
          components: [],
        });

        await updateFarm(userId, farm);

        deleteGameRoom(channel, 1000);
      }
    });

    collector.on("end", async () => {
      running = false;
      clearInterval(interval);

      await updateFarm(userId, farm);

      deleteGameRoom(channel, 1000);
    });
  },
};