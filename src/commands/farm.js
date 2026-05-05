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
const ROOM_TIME = 180000;

const GENERATORS = {
  egg_farm: {
    label: "Egg Farm",
    emoji: "🌱",
    ratePerHour: 50,
    baseCost: 500,
    flavour: "golden eggs are hatching under the Origin moonlight",
  },
  crypto_miner: {
    label: "Crypto Miner",
    emoji: "⛏️",
    ratePerHour: 200,
    baseCost: 2500,
    flavour: "miners are humming with black-gold energy",
  },
  vault_printer: {
    label: "Vault Printer",
    emoji: "🏭",
    ratePerHour: 1000,
    baseCost: 10000,
    flavour: "vault presses are stamping fresh Origin Coins",
  },
};

function formatOC(amount) {
  return Number(amount || 0).toLocaleString("en-GB");
}

function getUpgradeCost(type, owned) {
  const gen = GENERATORS[type];
  return Math.floor(gen.baseCost * Math.pow(1.55, owned));
}

function getTotalPerHour(farm) {
  return (
    Number(farm.egg_farm || 0) * GENERATORS.egg_farm.ratePerHour +
    Number(farm.crypto_miner || 0) * GENERATORS.crypto_miner.ratePerHour +
    Number(farm.vault_printer || 0) * GENERATORS.vault_printer.ratePerHour
  );
}

async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS generators (
      discord_id TEXT PRIMARY KEY,
      egg_farm INTEGER DEFAULT 1,
      crypto_miner INTEGER DEFAULT 0,
      vault_printer INTEGER DEFAULT 0,
      stored_oc DOUBLE PRECISION DEFAULT 0,
      last_update TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    ALTER TABLE generators
    ALTER COLUMN egg_farm SET DEFAULT 1
  `);

  await pool.query(`
    ALTER TABLE generators
    ALTER COLUMN stored_oc TYPE DOUBLE PRECISION
    USING stored_oc::DOUBLE PRECISION
  `);
}

async function ensureUser(discordId) {
  await pool.query(
    `INSERT INTO users (discord_id, eggs)
     VALUES ($1, 0)
     ON CONFLICT (discord_id) DO NOTHING`,
    [discordId]
  );
}

async function getBalance(discordId) {
  await ensureUser(discordId);

  const result = await pool.query(
    `SELECT eggs FROM users WHERE discord_id = $1`,
    [discordId]
  );

  return Number(result.rows[0]?.eggs || 0);
}

async function addCoins(discordId, amount) {
  await ensureUser(discordId);

  await pool.query(
    `UPDATE users
     SET eggs = eggs + $2
     WHERE discord_id = $1`,
    [discordId, Math.floor(amount)]
  );
}

async function removeCoins(discordId, amount) {
  await ensureUser(discordId);

  await pool.query(
    `UPDATE users
     SET eggs = eggs - $2
     WHERE discord_id = $1`,
    [discordId, Math.floor(amount)]
  );
}

async function ensureFarm(discordId) {
  await ensureTables();

  await pool.query(
    `INSERT INTO generators (discord_id, egg_farm)
     VALUES ($1, 1)
     ON CONFLICT (discord_id) DO NOTHING`,
    [discordId]
  );

  await pool.query(
    `UPDATE generators
     SET egg_farm = 1
     WHERE discord_id = $1
       AND egg_farm = 0
       AND crypto_miner = 0
       AND vault_printer = 0`,
    [discordId]
  );
}

async function getFarm(discordId) {
  await ensureFarm(discordId);

  const result = await pool.query(
    `SELECT * FROM generators WHERE discord_id = $1`,
    [discordId]
  );

  return result.rows[0];
}

async function saveFarm(discordId, farm) {
  await pool.query(
    `UPDATE generators
     SET egg_farm = $2,
         crypto_miner = $3,
         vault_printer = $4,
         stored_oc = $5,
         last_update = NOW()
     WHERE discord_id = $1`,
    [
      discordId,
      Number(farm.egg_farm || 0),
      Number(farm.crypto_miner || 0),
      Number(farm.vault_printer || 0),
      Number(farm.stored_oc || 0),
    ]
  );
}

function addOfflineEarnings(farm) {
  const lastUpdate = farm.last_update ? new Date(farm.last_update).getTime() : Date.now();
  const now = Date.now();

  const secondsAway = Math.max(0, Math.floor((now - lastUpdate) / 1000));
  const cappedSeconds = Math.min(secondsAway, 60 * 60 * 8);

  const perHour = getTotalPerHour(farm);
  const earned = (perHour / 3600) * cappedSeconds;

  farm.stored_oc = Number(farm.stored_oc || 0) + earned;

  return {
    farm,
    earned,
  };
}

function buildFarmEmbed(user, farm, liveGain = 0, eventText = null) {
  const eggCount = Number(farm.egg_farm || 0);
  const minerCount = Number(farm.crypto_miner || 0);
  const printerCount = Number(farm.vault_printer || 0);

  const perHour = getTotalPerHour(farm);

  const eggCost = getUpgradeCost("egg_farm", eggCount);
  const minerCost = getUpgradeCost("crypto_miner", minerCount);
  const printerCost = getUpgradeCost("vault_printer", printerCount);

  const moodLines = [
    "The air glows with black-gold sparks.",
    "Tiny Origin Coins shimmer between the machines.",
    "The farm hums like a hidden casino vault.",
    "Golden mist rolls through the generator room.",
    "The vault engines pulse with magical energy.",
    "The Egg Farm cracks open glowing golden shells.",
    "Origin Coins drip through the vault pipes like liquid gold.",
  ];

  const mood = eventText || moodLines[Math.floor(Math.random() * moodLines.length)];

  return new EmbedBuilder()
    .setTitle("ORIGIN GENERATOR ROOM")
    .setColor(0xd4af37)
    .setDescription(
      `**${mood}**\n\n` +
      `Stored OC: **${formatOC(Math.floor(farm.stored_oc))} OC**\n` +
      `Live Tick: **+${Number(liveGain).toFixed(2)} OC**\n` +
      `Production: **${formatOC(perHour)} OC/hour**\n\n` +
      `${GENERATORS.egg_farm.emoji} Egg Farms: **${eggCount}**\n` +
      `${GENERATORS.crypto_miner.emoji} Crypto Miners: **${minerCount}**\n` +
      `${GENERATORS.vault_printer.emoji} Vault Printers: **${printerCount}**`
    )
    .addFields(
      {
        name: "Next Egg Farm",
        value: `${formatOC(eggCost)} OC`,
        inline: true,
      },
      {
        name: "Next Crypto Miner",
        value: `${formatOC(minerCost)} OC`,
        inline: true,
      },
      {
        name: "Next Vault Printer",
        value: `${formatOC(printerCost)} OC`,
        inline: true,
      }
    )
    .setFooter({
      text: `Origin Passive Income • ${user.username}`,
    })
    .setTimestamp();
}

function buildMainButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("origin_farm_collect")
      .setLabel("Collect OC")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("origin_farm_upgrade")
      .setLabel("Upgrade")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("origin_farm_close")
      .setLabel("Close Room")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildUpgradeButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("origin_buy_egg_farm")
      .setLabel("Buy Egg Farm")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("origin_buy_crypto_miner")
      .setLabel("Buy Miner")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("origin_buy_vault_printer")
      .setLabel("Buy Printer")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("origin_farm_back")
      .setLabel("Back")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildGoToRoomRow(channelUrl) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Go To Generator Room")
      .setStyle(ButtonStyle.Link)
      .setURL(channelUrl)
  );
}

async function renderPanel(panel, interaction, farm, liveGain = 0, eventText = null, upgradeMode = false) {
  await panel.edit({
    content: `${interaction.user}, your generators are active.`,
    embeds: [buildFarmEmbed(interaction.user, farm, liveGain, eventText)],
    components: [upgradeMode ? buildUpgradeButtons() : buildMainButtons()],
  });
}

async function buyGenerator(userId, farm, type) {
  const owned = Number(farm[type] || 0);
  const cost = getUpgradeCost(type, owned);
  const balance = await getBalance(userId);

  if (balance < cost) {
    return {
      ok: false,
      message: `Not enough OC. You need **${formatOC(cost)} OC** but only have **${formatOC(balance)} OC**.`,
    };
  }

  await removeCoins(userId, cost);

  farm[type] = owned + 1;

  return {
    ok: true,
    message: `${GENERATORS[type].emoji} Purchased **${GENERATORS[type].label}** for **${formatOC(cost)} OC**. ${GENERATORS[type].flavour}.`,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("farm")
    .setDescription("Open your Origin Generator Room"),

  async execute(interaction) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const userId = interaction.user.id;

    const roomResult = await createGameRoom(interaction, "farm");

    if (roomResult.alreadyExists) {
      return interaction.editReply({
        content: `You already have an active Origin generator room: ${roomResult.channel}`,
        components: [buildGoToRoomRow(roomResult.channel.url)],
      });
    }

    const channel = roomResult.channel;

    await interaction.editReply({
      content: `Your Origin Generator Room is ready: ${channel}`,
      components: [buildGoToRoomRow(channel.url)],
    });

    let farm = await getFarm(userId);

    const offline = addOfflineEarnings(farm);
    farm = offline.farm;
    await saveFarm(userId, farm);

    const panel = await channel.send({
      content: `${interaction.user}, powering up your Origin generators...`,
    });

    let running = true;
    let upgradeMode = false;

    await renderPanel(
      panel,
      interaction,
      farm,
      0,
      offline.earned > 0
        ? `Your machines worked while you were away and created ${formatOC(Math.floor(offline.earned))} OC.`
        : "Your first Egg Farm glows under the Origin moonlight.",
      upgradeMode
    );

    const interval = setInterval(async () => {
      if (!running) return;

      const perHour = getTotalPerHour(farm);
      const liveGain = (perHour / 3600) * (TICK_MS / 1000);

      farm.stored_oc = Number(farm.stored_oc || 0) + liveGain;

      await saveFarm(userId, farm);

      try {
        await renderPanel(panel, interaction, farm, liveGain, null, upgradeMode);
      } catch (error) {
        console.error("Origin generator panel update failed:", error);
      }
    }, TICK_MS);

    const collector = panel.createMessageComponentCollector({
      time: ROOM_TIME,
    });

    collector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.user.id !== userId) {
        return buttonInteraction.reply({
          content: "This is not your Origin Generator Room.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (buttonInteraction.customId === "origin_farm_close") {
        running = false;
        clearInterval(interval);
        collector.stop("closed");

        await saveFarm(userId, farm);

        await buttonInteraction.update({
          content: "Closing your Origin Generator Room.",
          embeds: [],
          components: [],
        });

        deleteGameRoom(channel, 1000);
        return;
      }

      if (buttonInteraction.customId === "origin_farm_collect") {
        const amount = Math.floor(Number(farm.stored_oc || 0));

        if (amount <= 0) {
          return buttonInteraction.reply({
            content: "Your generators have not produced enough OC to collect yet.",
            flags: MessageFlags.Ephemeral,
          });
        }

        farm.stored_oc = Number(farm.stored_oc || 0) - amount;

        await addCoins(userId, amount);
        await saveFarm(userId, farm);

        await buttonInteraction.deferUpdate();

        await renderPanel(
          panel,
          interaction,
          farm,
          0,
          `You collected ${formatOC(amount)} OC. The vault pipes flash gold as the coins transfer to your balance.`,
          upgradeMode
        );

        return;
      }

      if (buttonInteraction.customId === "origin_farm_upgrade") {
        upgradeMode = true;

        await buttonInteraction.deferUpdate();

        await renderPanel(
          panel,
          interaction,
          farm,
          0,
          "Choose a machine to build. Each upgrade increases your passive OC production.",
          upgradeMode
        );

        return;
      }

      if (buttonInteraction.customId === "origin_farm_back") {
        upgradeMode = false;

        await buttonInteraction.deferUpdate();

        await renderPanel(
          panel,
          interaction,
          farm,
          0,
          "Returned to your live generator panel.",
          upgradeMode
        );

        return;
      }

      if (
        buttonInteraction.customId === "origin_buy_egg_farm" ||
        buttonInteraction.customId === "origin_buy_crypto_miner" ||
        buttonInteraction.customId === "origin_buy_vault_printer"
      ) {
        let type = "egg_farm";

        if (buttonInteraction.customId === "origin_buy_crypto_miner") {
          type = "crypto_miner";
        }

        if (buttonInteraction.customId === "origin_buy_vault_printer") {
          type = "vault_printer";
        }

        const result = await buyGenerator(userId, farm, type);

        if (!result.ok) {
          return buttonInteraction.reply({
            content: result.message,
            flags: MessageFlags.Ephemeral,
          });
        }

        await saveFarm(userId, farm);

        await buttonInteraction.deferUpdate();

        await renderPanel(
          panel,
          interaction,
          farm,
          0,
          result.message,
          upgradeMode
        );

        return;
      }
    });

    collector.on("end", async (_, reason) => {
      running = false;
      clearInterval(interval);

      await saveFarm(userId, farm);

      if (reason !== "closed") {
        deleteGameRoom(channel, 1000);
      }
    });
  },
};