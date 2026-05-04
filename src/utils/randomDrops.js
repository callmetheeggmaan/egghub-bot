const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const pool = require("../db/pool");
const { BRAND, formatCurrency } = require("../config/brand");

const DROP_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DROP_CLAIM_WINDOW_MS = 30 * 60 * 1000;
const DELETE_AFTER_CLAIM_MS = 20 * 1000;

let nextDropAt = null;
let dropTimeout = null;

const DROPS = [
  {
    id: "chip_jackpot_small",
    type: "coins",
    name: "Mini Coin Jackpot",
    amount: 5000,
    rarity: "Common",
    weight: 45
  },
  {
    id: "chip_jackpot_medium",
    type: "coins",
    name: "Origin Cashout",
    amount: 15000,
    rarity: "Rare",
    weight: 30
  },
  {
    id: "chip_jackpot_big",
    type: "coins",
    name: "High Roller Payout",
    amount: 40000,
    rarity: "Epic",
    weight: 15
  },
  {
    id: "golden_case_drop",
    type: "case",
    name: "Golden Origin Vault",
    itemId: "golden_egg_case",
    itemName: "Golden Origin Vault",
    itemType: "case",
    rarity: "Legendary",
    weight: 6
  },
  {
    id: "basic_case_drop",
    type: "case",
    name: "Bronze Origin Vault",
    itemId: "basic_egg_case",
    itemName: "Bronze Origin Vault",
    itemType: "case",
    rarity: "Rare",
    weight: 20
  },
  {
    id: "luck_boost_drop",
    type: "boost",
    name: "Vault Luck Boost",
    boostId: "luck_boost_30m",
    boostName: "Vault Luck Boost",
    multiplier: 1.35,
    durationMinutes: 30,
    rarity: "Epic",
    weight: 10
  }
];

function getColorByRarity(rarity) {
  if (rarity === "Legendary") return BRAND.colour;
  if (rarity === "Epic") return 0x8b5cf6;
  if (rarity === "Rare") return 0x3b82f6;
  return 0x8a8a8a;
}

function getNextDropCountdown() {
  if (!nextDropAt) return "Not scheduled";

  const remaining = Math.max(0, nextDropAt - Date.now());

  const hours = Math.floor(remaining / 1000 / 60 / 60);
  const minutes = Math.floor((remaining / 1000 / 60) % 60);
  const seconds = Math.floor((remaining / 1000) % 60);

  return `${hours}h ${minutes}m ${seconds}s`;
}

function rollDrop() {
  const totalWeight = DROPS.reduce((sum, drop) => sum + drop.weight, 0);
  const roll = Math.random() * totalWeight;

  let current = 0;

  for (const drop of DROPS) {
    current += drop.weight;
    if (roll <= current) return drop;
  }

  return DROPS[0];
}

async function ensureUser(discordId, username) {
  const result = await pool.query(
    "SELECT * FROM users WHERE discord_id = $1",
    [discordId]
  );

  if (result.rows.length === 0) {
    await pool.query(
      "INSERT INTO users (discord_id, username, eggs) VALUES ($1, $2, $3)",
      [discordId, username, 0]
    );
  }
}

async function addCoins(discordId, amount) {
  await pool.query(
    "UPDATE users SET eggs = eggs + $1 WHERE discord_id = $2",
    [amount, discordId]
  );
}

async function addInventoryItem(discordId, drop) {
  await pool.query(
    `
    INSERT INTO user_inventory
    (discord_id, item_id, item_name, item_type, quantity)
    VALUES ($1, $2, $3, $4, 1)
    ON CONFLICT (discord_id, item_id)
    DO UPDATE SET
      quantity = user_inventory.quantity + 1,
      updated_at = NOW()
    `,
    [discordId, drop.itemId, drop.itemName, drop.itemType]
  );
}

async function activateBoost(discordId, drop) {
  const expiresAt = new Date(Date.now() + drop.durationMinutes * 60 * 1000);

  await pool.query(
    `
    INSERT INTO active_boosts
    (discord_id, boost_id, boost_name, multiplier, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [discordId, drop.boostId, drop.boostName, drop.multiplier, expiresAt]
  );
}

async function applyDropReward(user, drop) {
  await ensureUser(user.id, user.username);

  if (drop.type === "coins") {
    await addCoins(user.id, drop.amount);
    return `won **${formatCurrency(drop.amount)}**`;
  }

  if (drop.type === "case") {
    await addInventoryItem(user.id, drop);
    return `won **${drop.itemName}**`;
  }

  if (drop.type === "boost") {
    await activateBoost(user.id, drop);
    return `won **${drop.boostName}** for **${drop.durationMinutes} minutes**`;
  }

  return "won a mystery reward";
}

function buildDropEmbed(drop) {
  return new EmbedBuilder()
    .setTitle("Origin Drop Available")
    .setDescription(
      [
        "A premium drop has entered the room.",
        "",
        `**Reward:** ${drop.name}`,
        `**Tier:** ${drop.rarity}`,
        "",
        "First player to claim receives the reward."
      ].join("\n")
    )
    .setColor(getColorByRarity(drop.rarity))
    .setFooter({ text: `${BRAND.fullName} • Drops every 4 hours` });
}

function buildClaimedEmbed(drop, user, rewardText) {
  return new EmbedBuilder()
    .setTitle("Drop Claimed")
    .setDescription(
      [
        `${user} ${rewardText}`,
        "",
        `**Reward:** ${drop.name}`,
        `**Tier:** ${drop.rarity}`,
        "",
        "This message will clear shortly."
      ].join("\n")
    )
    .setColor(getColorByRarity(drop.rarity))
    .setFooter({ text: `${BRAND.fullName} • Drop complete` });
}

function buildExpiredEmbed() {
  return new EmbedBuilder()
    .setTitle("Drop Expired")
    .setDescription("Nobody claimed this Origin drop in time.")
    .setColor(0x6b7280)
    .setFooter({ text: `${BRAND.fullName} • Drop expired` });
}

function buildDropButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim_casino_drop")
      .setLabel("Claim Drop")
      .setStyle(ButtonStyle.Success)
  );
}

async function deleteMessageLater(message, delayMs) {
  setTimeout(async () => {
    try {
      await message.delete();
    } catch (error) {
      console.error("Failed to delete drop message:", error.message);
    }
  }, delayMs);
}

async function sendRandomDrop(client) {
  const channelId = process.env.RANDOM_DROP_CHANNEL_ID;

  if (!channelId) {
    console.error("RANDOM_DROP_CHANNEL_ID is missing from Railway variables.");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    console.error("Could not find random drop channel:", channelId);
    return;
  }

  const drop = rollDrop();

  const message = await channel.send({
    embeds: [buildDropEmbed(drop)],
    components: [buildDropButton()]
  });

  let claimed = false;

  const collector = message.createMessageComponentCollector({
    time: DROP_CLAIM_WINDOW_MS
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId !== "claim_casino_drop") return;

    if (claimed) {
      return interaction.reply({
        content: "This drop has already been claimed.",
        ephemeral: true
      });
    }

    claimed = true;

    try {
      const rewardText = await applyDropReward(interaction.user, drop);

      await interaction.update({
        embeds: [buildClaimedEmbed(drop, interaction.user, rewardText)],
        components: []
      });

      collector.stop("claimed");

      await deleteMessageLater(message, DELETE_AFTER_CLAIM_MS);
    } catch (error) {
      console.error("Drop claim error:", error);

      claimed = false;

      return interaction.reply({
        content: "Failed to claim this drop.",
        ephemeral: true
      });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason === "claimed") return;

    try {
      await message.edit({
        embeds: [buildExpiredEmbed()],
        components: []
      });

      await deleteMessageLater(message, 15 * 1000);
    } catch (error) {
      console.error("Failed to expire drop:", error);
    }
  });
}

function scheduleNextDrop(client) {
  if (dropTimeout) clearTimeout(dropTimeout);

  nextDropAt = Date.now() + DROP_INTERVAL_MS;

  dropTimeout = setTimeout(async () => {
    try {
      await sendRandomDrop(client);
    } catch (error) {
      console.error("Scheduled Origin drop failed:", error);
    }

    scheduleNextDrop(client);
  }, DROP_INTERVAL_MS);
}

function startRandomDrops(client) {
  console.log("Origin random drops started. Interval: 4 hours.");

  scheduleNextDrop(client);
}

module.exports = {
  startRandomDrops,
  sendRandomDrop,
  getNextDropCountdown
};