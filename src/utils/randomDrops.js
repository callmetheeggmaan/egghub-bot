const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const pool = require("../db/pool");
const { formatCurrency } = require("../config/currency");

const DROP_INTERVAL_MS = 4 * 60 * 60 * 1000;

const DROPS = [
  {
    id: "chip_jackpot_small",
    type: "chips",
    name: "Mini Chip Jackpot",
    emoji: "🟡",
    amount: 5000,
    rarity: "Common",
    weight: 45
  },
  {
    id: "chip_jackpot_medium",
    type: "chips",
    name: "Casino Cashout",
    emoji: "💰",
    amount: 15000,
    rarity: "Rare",
    weight: 30
  },
  {
    id: "chip_jackpot_big",
    type: "chips",
    name: "High Roller Payout",
    emoji: "🎰",
    amount: 40000,
    rarity: "Epic",
    weight: 15
  },
  {
    id: "golden_case_drop",
    type: "case",
    name: "Golden Jackpot Case",
    emoji: "💼",
    itemId: "golden_egg_case",
    itemName: "Golden Jackpot Case",
    itemType: "case",
    rarity: "Legendary",
    weight: 6
  },
  {
    id: "basic_case_drop",
    type: "case",
    name: "Bronze Vault Case",
    emoji: "📦",
    itemId: "basic_egg_case",
    itemName: "Bronze Vault Case",
    itemType: "case",
    rarity: "Rare",
    weight: 20
  },
  {
    id: "luck_boost_drop",
    type: "boost",
    name: "Casino Luck Boost",
    emoji: "🍀",
    boostId: "luck_boost_30m",
    boostName: "Casino Luck Boost",
    multiplier: 1.35,
    durationMinutes: 30,
    rarity: "Epic",
    weight: 10
  }
];

function getColorByRarity(rarity) {
  if (rarity === "Legendary") return 0xfacc15;
  if (rarity === "Epic") return 0xa855f7;
  if (rarity === "Rare") return 0x3b82f6;
  return 0x9ca3af;
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

async function addChips(discordId, amount) {
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

  if (drop.type === "chips") {
    await addChips(user.id, drop.amount);
    return `won **${formatCurrency(drop.amount)}**`;
  }

  if (drop.type === "case") {
    await addInventoryItem(user.id, drop);
    return `won **${drop.emoji} ${drop.itemName}**`;
  }

  if (drop.type === "boost") {
    await activateBoost(user.id, drop);
    return `won **${drop.emoji} ${drop.boostName}** for **${drop.durationMinutes} minutes**`;
  }

  return "won a mystery reward";
}

function buildDropEmbed(drop) {
  return new EmbedBuilder()
    .setTitle("🎰 CASINO DROP HAS LANDED")
    .setDescription(
      [
        "A rare casino drop has appeared.",
        "",
        `${drop.emoji} **${drop.name}**`,
        `Rarity: **${drop.rarity}**`,
        "",
        "First player to press the button claims it."
      ].join("\n")
    )
    .setColor(getColorByRarity(drop.rarity))
    .setFooter({ text: "EggHub Casino • Drops every 4 hours" });
}

function buildClaimedEmbed(drop, user, rewardText) {
  return new EmbedBuilder()
    .setTitle("🎉 DROP CLAIMED")
    .setDescription(
      [
        `${user} ${rewardText}`,
        "",
        `${drop.emoji} **${drop.name}**`,
        `Rarity: **${drop.rarity}**`
      ].join("\n")
    )
    .setColor(getColorByRarity(drop.rarity))
    .setFooter({ text: "Next casino drop arrives later" });
}

function buildDropButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim_casino_drop")
      .setLabel("Claim Drop")
      .setEmoji("🎰")
      .setStyle(ButtonStyle.Success)
  );
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
    time: 30 * 60 * 1000
  });

  collector.on("collect", async (interaction) => {
    if (interaction.customId !== "claim_casino_drop") return;

    if (claimed) {
      return interaction.reply({
        content: "❌ This drop has already been claimed.",
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
    } catch (error) {
      console.error("Drop claim error:", error);

      claimed = false;

      return interaction.reply({
        content: "❌ Failed to claim this drop.",
        ephemeral: true
      });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason === "claimed") return;

    try {
      await message.edit({
        embeds: [
          new EmbedBuilder()
            .setTitle("⌛ Casino Drop Expired")
            .setDescription("Nobody claimed the drop in time.")
            .setColor(0x6b7280)
        ],
        components: []
      });
    } catch (error) {
      console.error("Failed to expire drop:", error);
    }
  });
}

function startRandomDrops(client) {
  console.log("Casino random drops started. Interval: 4 hours.");

  setTimeout(() => {
    sendRandomDrop(client);
  }, 60 * 1000);

  setInterval(() => {
    sendRandomDrop(client);
  }, DROP_INTERVAL_MS);
}

module.exports = {
  startRandomDrops,
  sendRandomDrop
};