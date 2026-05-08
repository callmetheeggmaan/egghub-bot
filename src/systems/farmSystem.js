const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const GENERATORS = {
  egg_farm: {
    label: "Egg Farm",
    emoji: "🌱",
    ratePerHour: 50,
    baseCost: 500,
    flavour: "golden eggs hatch under the Origin moonlight",
  },
  crypto_miner: {
    label: "Crypto Miner",
    emoji: "⛏️",
    ratePerHour: 200,
    baseCost: 2500,
    flavour: "miners hum with black-gold energy",
  },
  vault_printer: {
    label: "Vault Printer",
    emoji: "🏭",
    ratePerHour: 1000,
    baseCost: 10000,
    flavour: "vault presses stamp fresh Origin Coins",
  },
};

function formatOC(amount) {
  return Number(amount || 0).toLocaleString("en-GB");
}

function getUpgradeCost(type, owned) {
  return Math.floor(GENERATORS[type].baseCost * Math.pow(1.55, owned));
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

function applyOfflineEarnings(farm) {
  const lastUpdate = farm.last_update ? new Date(farm.last_update).getTime() : Date.now();
  const now = Date.now();

  const secondsAway = Math.max(0, Math.floor((now - lastUpdate) / 1000));
  const cappedSeconds = Math.min(secondsAway, 60 * 60 * 8);

  const perHour = getTotalPerHour(farm);
  const earned = (perHour / 3600) * cappedSeconds;

  farm.stored_oc = Number(farm.stored_oc || 0) + earned;

  return { farm, earned };
}

function buildFarmEmbed(user, farm, eventText = null) {
  const eggCount = Number(farm.egg_farm || 0);
  const minerCount = Number(farm.crypto_miner || 0);
  const printerCount = Number(farm.vault_printer || 0);
  const perHour = getTotalPerHour(farm);

  const eggCost = getUpgradeCost("egg_farm", eggCount);
  const minerCost = getUpgradeCost("crypto_miner", minerCount);
  const printerCost = getUpgradeCost("vault_printer", printerCount);

  const moods = [
    "Origin Coins drip through the vault pipes like liquid gold.",
    "The generator room hums with black-gold energy.",
    "Golden sparks flicker around the machines.",
    "The vault engines pulse beneath the floor.",
    "The Egg Farms glow under the Origin moonlight.",
  ];

  const mood = eventText || moods[Math.floor(Math.random() * moods.length)];

  return new EmbedBuilder()
    .setTitle("ORIGIN GENERATOR ROOM")
    .setColor(0xd4af37)
    .setDescription(
      `**${mood}**\n\n` +
      `Stored OC: **${formatOC(Math.floor(farm.stored_oc))} OC**\n` +
      `Production: **${formatOC(perHour)} OC/hour**\n\n` +
      `${GENERATORS.egg_farm.emoji} Egg Farms: **${eggCount}**\n` +
      `${GENERATORS.crypto_miner.emoji} Crypto Miners: **${minerCount}**\n` +
      `${GENERATORS.vault_printer.emoji} Vault Printers: **${printerCount}**`
    )
    .addFields(
      { name: "Next Egg Farm", value: `${formatOC(eggCost)} OC`, inline: true },
      { name: "Next Crypto Miner", value: `${formatOC(minerCost)} OC`, inline: true },
      { name: "Next Vault Printer", value: `${formatOC(printerCost)} OC`, inline: true }
    )
    .setFooter({ text: `Origin Passive Income • ${user.username}` })
    .setTimestamp();
}

function mainButtons() {
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
      .setCustomId("origin_farm_refresh")
      .setLabel("Refresh")
      .setStyle(ButtonStyle.Secondary)
  );
}

function upgradeButtons() {
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

async function refreshFarmPanel(interaction, mode = "main", eventText = null) {
  const userId = interaction.user.id;

  let farm = await getFarm(userId);
  const offline = applyOfflineEarnings(farm);
  farm = offline.farm;

  await saveFarm(userId, farm);

  const text =
    eventText ||
    (offline.earned >= 1
      ? `Your generators produced ${formatOC(Math.floor(offline.earned))} OC while running.`
      : "The control panel refreshes with a pulse of gold.");

  await interaction.update({
    content: `${interaction.user}, your generators are active.`,
    embeds: [buildFarmEmbed(interaction.user, farm, text)],
    components: [mode === "upgrade" ? upgradeButtons() : mainButtons()],
  });
}

async function collectFarm(interaction) {
  const userId = interaction.user.id;

  let farm = await getFarm(userId);
  const offline = applyOfflineEarnings(farm);
  farm = offline.farm;

  const amount = Math.floor(Number(farm.stored_oc || 0));

  if (amount <= 0) {
    await saveFarm(userId, farm);

    return interaction.reply({
      content: "Your generators have not produced enough OC to collect yet.",
      flags: MessageFlags.Ephemeral,
    });
  }

  farm.stored_oc = Number(farm.stored_oc || 0) - amount;

  await addCoins(userId, amount);
  await saveFarm(userId, farm);

  await interaction.update({
    content: `${interaction.user}, your generators are active.`,
    embeds: [
      buildFarmEmbed(
        interaction.user,
        farm,
        `You collected **${formatOC(amount)} OC**. The vault pipes flashed gold as the coins transferred to your balance.`
      ),
    ],
    components: [mainButtons()],
  });
}

async function buyGenerator(interaction, type) {
  const userId = interaction.user.id;

  let farm = await getFarm(userId);
  const offline = applyOfflineEarnings(farm);
  farm = offline.farm;

  const owned = Number(farm[type] || 0);
  const cost = getUpgradeCost(type, owned);
  const balance = await getBalance(userId);

  if (balance < cost) {
    return interaction.reply({
      content: `Not enough OC. You need **${formatOC(cost)} OC** but only have **${formatOC(balance)} OC**.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await removeCoins(userId, cost);

  farm[type] = owned + 1;

  await saveFarm(userId, farm);

  await interaction.update({
    content: `${interaction.user}, your generators are active.`,
    embeds: [
      buildFarmEmbed(
        interaction.user,
        farm,
        `${GENERATORS[type].emoji} Purchased **${GENERATORS[type].label}** for **${formatOC(cost)} OC**. ${GENERATORS[type].flavour}.`
      ),
    ],
    components: [upgradeButtons()],
  });
}

async function handleFarmButton(interaction) {
  try {
    if (!interaction.isButton()) return false;

    const farmButton =
      interaction.customId.startsWith("origin_farm") ||
      interaction.customId.startsWith("origin_buy");

    if (!farmButton) return false;

    const topic = interaction.channel?.topic || "";
    const ownerId = topic.split(":")[1];

    if (ownerId && interaction.user.id !== ownerId) {
      await interaction.reply({
        content: "You can view this generator room, but only the owner can use these buttons.",
        flags: MessageFlags.Ephemeral,
      });

      return true;
    }

    if (interaction.customId === "origin_farm_collect") {
      await collectFarm(interaction);
      return true;
    }

    if (interaction.customId === "origin_farm_upgrade") {
      await refreshFarmPanel(
        interaction,
        "upgrade",
        "Choose a machine to build. Each upgrade increases your passive OC production."
      );
      return true;
    }

    if (interaction.customId === "origin_farm_back") {
      await refreshFarmPanel(interaction, "main", "Returned to your live generator panel.");
      return true;
    }

    if (interaction.customId === "origin_farm_refresh") {
      await refreshFarmPanel(interaction, "main", "The control panel refreshes with a pulse of gold.");
      return true;
    }

    if (interaction.customId === "origin_buy_egg_farm") {
      await buyGenerator(interaction, "egg_farm");
      return true;
    }

    if (interaction.customId === "origin_buy_crypto_miner") {
      await buyGenerator(interaction, "crypto_miner");
      return true;
    }

    if (interaction.customId === "origin_buy_vault_printer") {
      await buyGenerator(interaction, "vault_printer");
      return true;
    }

    return false;
  } catch (error) {
    console.error("Permanent farm button error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "The generator panel hit an error. Use `/farm` again to refresh it.",
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    return true;
  }
}

module.exports = {
  getFarm,
  applyOfflineEarnings,
  saveFarm,
  buildFarmEmbed,
  mainButtons,
  handleFarmButton,
};