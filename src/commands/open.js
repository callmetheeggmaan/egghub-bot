const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

const pool = require("../db/pool");
const { getLuckMultiplier } = require("../utils/boosts");
const { BRAND, formatCurrency, originLine } = require("../config/brand");
const { addToJackpot, rollJackpotWin, payJackpot } = require("../utils/jackpot");

const COLORS = {
  Common: 0x8a8a8a,
  Rare: 0x3b82f6,
  Epic: 0x8b5cf6,
  Legendary: BRAND.colour,
  Mythic: 0xff004c
};

const CASES = {
  basic_egg_case: {
    name: "Bronze Origin Vault",
    icon: "▣",
    color: 0x8a8a8a,
    jackpotContribution: 500,
    rewards: [
      { type: "coins", name: "100 OC", icon: "◇", amount: 100, chance: 40, rarity: "Common" },
      { type: "coins", name: "300 OC", icon: "◇", amount: 300, chance: 25, rarity: "Common" },
      { type: "coins", name: "700 OC", icon: "◆", amount: 700, chance: 15, rarity: "Rare" },
      { type: "coins", name: "1,500 OC", icon: "◆", amount: 1500, chance: 8, rarity: "Epic" },
      { type: "boost", name: "Double Coin Boost", icon: "◆", boostId: "double_chips_30m", chance: 7, rarity: "Rare" },
      { type: "role", name: "High Roller Role", icon: "♛", roleName: "High Roller", chance: 5, rarity: "Epic" }
    ]
  },

  golden_egg_case: {
    name: "Golden Origin Vault",
    icon: "◆",
    color: BRAND.colour,
    jackpotContribution: 1500,
    rewards: [
      { type: "coins", name: "500 OC", icon: "◇", amount: 500, chance: 30, rarity: "Common" },
      { type: "coins", name: "1,500 OC", icon: "◆", amount: 1500, chance: 25, rarity: "Rare" },
      { type: "coins", name: "3,000 OC", icon: "◆", amount: 3000, chance: 18, rarity: "Epic" },
      { type: "coins", name: "7,500 OC", icon: "♚", amount: 7500, chance: 7, rarity: "Legendary" },
      { type: "boost", name: "Vault Luck Boost", icon: "◇", boostId: "luck_boost_30m", chance: 12, rarity: "Epic" },
      { type: "role", name: "Origin Elite Role", icon: "♚", roleName: "Origin Elite", chance: 8, rarity: "Legendary" }
    ]
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressBar(step, total) {
  const filled = Math.round((step / total) * 10);
  const empty = 10 - filled;
  return "◆".repeat(filled) + "◇".repeat(empty);
}

function rarityTier(rarity) {
  if (rarity === "Mythic") return "MYTHIC TIER";
  if (rarity === "Legendary") return "GOLD TIER";
  if (rarity === "Epic") return "ELITE TIER";
  if (rarity === "Rare") return "RARE TIER";
  return "STANDARD TIER";
}

function rollReward(caseId, luck = 1) {
  const caseData = CASES[caseId];
  const rewards = caseData.rewards;

  const adjustedRewards = rewards.map((reward) => {
    let adjustedChance = reward.chance;

    if (reward.rarity === "Rare") adjustedChance *= luck;
    if (reward.rarity === "Epic") adjustedChance *= luck;
    if (reward.rarity === "Legendary") adjustedChance *= luck;

    return {
      ...reward,
      adjustedChance
    };
  });

  const totalChance = adjustedRewards.reduce(
    (total, reward) => total + reward.adjustedChance,
    0
  );

  const roll = Math.random() * totalChance;

  let cumulative = 0;

  for (const reward of adjustedRewards) {
    cumulative += reward.adjustedChance;
    if (roll <= cumulative) return reward;
  }

  return adjustedRewards[0];
}

function getRandomReward(caseId) {
  const rewards = CASES[caseId].rewards;
  return rewards[Math.floor(Math.random() * rewards.length)];
}

function buildCaseSelectEmbed(cases) {
  const embed = new EmbedBuilder()
    .setTitle(`${BRAND.name} Vault Access`)
    .setDescription(
      [
        originLine(),
        "Select a vault below to begin the reveal sequence.",
        "Luck boosts improve rare reward odds.",
        originLine()
      ].join("\n")
    )
    .setColor(BRAND.colour)
    .setFooter({ text: `${BRAND.fullName} • Vault System` });

  for (const item of cases) {
    const displayName = CASES[item.item_id]?.name || item.item_name;

    embed.addFields({
      name: `▣ ${displayName}`,
      value: `Owned: **${item.quantity}**`,
      inline: true
    });
  }

  return embed;
}

function buildOpeningEmbed(caseData, spinReward, step, total) {
  return new EmbedBuilder()
    .setTitle(`${caseData.icon} ${caseData.name}`)
    .setDescription(
      [
        originLine(),
        "**Reveal sequence active**",
        "",
        progressBar(step, total),
        "",
        `Current reward: ${spinReward.icon} **${spinReward.name}**`,
        `Tier: **${rarityTier(spinReward.rarity)}**`,
        originLine()
      ].join("\n")
    )
    .setColor(COLORS[spinReward.rarity] || caseData.color)
    .setFooter({ text: `${BRAND.fullName} • Opening Vault` });
}

function buildWinEmbed(caseData, reward) {
  return new EmbedBuilder()
    .setTitle(`${BRAND.name} Reward Claimed`)
    .setDescription(
      [
        originLine(),
        `Vault: **${caseData.name}**`,
        "",
        `Reward: ${reward.icon} **${reward.name}**`,
        `Tier: **${rarityTier(reward.rarity)}**`,
        originLine()
      ].join("\n")
    )
    .setColor(COLORS[reward.rarity] || caseData.color)
    .setFooter({ text: `${BRAND.fullName} • Reward added to your account` });
}

function buildOpenAgainRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_again")
      .setLabel("Open Another Vault")
      .setStyle(ButtonStyle.Success)
  );
}

function buildCaseButtons(cases) {
  const row = new ActionRowBuilder();

  for (const item of cases.slice(0, 5)) {
    const displayName = CASES[item.item_id]?.name || item.item_name;

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`open_${item.item_id}`)
        .setLabel(`${displayName} x${item.quantity}`)
        .setStyle(item.item_id === "golden_egg_case" ? ButtonStyle.Danger : ButtonStyle.Primary)
    );
  }

  return [row];
}

async function getInventory(discordId) {
  const result = await pool.query(
    "SELECT * FROM user_inventory WHERE discord_id = $1",
    [discordId]
  );

  return result.rows;
}

async function removeItem(discordId, itemId) {
  await pool.query(
    `
    UPDATE user_inventory
    SET quantity = quantity - 1,
        updated_at = NOW()
    WHERE discord_id = $1
    AND item_id = $2
    `,
    [discordId, itemId]
  );

  await pool.query(
    `
    DELETE FROM user_inventory
    WHERE discord_id = $1
    AND item_id = $2
    AND quantity <= 0
    `,
    [discordId, itemId]
  );
}

async function addCoins(discordId, amount) {
  await pool.query(
    "UPDATE users SET eggs = eggs + $1 WHERE discord_id = $2",
    [amount, discordId]
  );
}

async function activateBoost(discordId, reward) {
  const boostData = {
    double_eggs_30m: {
      name: "Double Coin Boost",
      multiplier: 2,
      durationMinutes: 30
    },
    double_chips_30m: {
      name: "Double Coin Boost",
      multiplier: 2,
      durationMinutes: 30
    },
    luck_boost_30m: {
      name: "Vault Luck Boost",
      multiplier: 1.35,
      durationMinutes: 30
    }
  };

  const boost = boostData[reward.boostId];

  if (!boost) return;

  const expiresAt = new Date(Date.now() + boost.durationMinutes * 60 * 1000);

  await pool.query(
    `
    INSERT INTO active_boosts
    (discord_id, boost_id, boost_name, multiplier, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [discordId, reward.boostId, boost.name, boost.multiplier, expiresAt]
  );
}

async function giveRole(interaction, roleName) {
  const role = interaction.guild.roles.cache.find(
    (serverRole) => serverRole.name.toLowerCase() === roleName.toLowerCase()
  );

  if (!role) {
    throw new Error(`Role "${roleName}" does not exist.`);
  }

  await interaction.member.roles.add(role);
}

async function applyReward(interaction, reward) {
  const discordId = interaction.user.id;

  if (reward.type === "coins") {
    await addCoins(discordId, reward.amount);
  }

  if (reward.type === "boost") {
    await activateBoost(discordId, reward);
  }

  if (reward.type === "role") {
    await giveRole(interaction, reward.roleName);
  }
}

async function showCaseMenu(interaction, discordId) {
  const inventory = await getInventory(discordId);
  const cases = inventory.filter(
    (item) => item.item_type === "case" && CASES[item.item_id] && item.quantity > 0
  );

  if (cases.length === 0) {
    await interaction.editReply({
      content: "No vaults available. Visit `/shop` to purchase one.",
      embeds: [],
      components: []
    });
    return false;
  }

  await interaction.editReply({
    content: "",
    embeds: [buildCaseSelectEmbed(cases)],
    components: buildCaseButtons(cases)
  });

  return true;
}

async function openCase(interaction, buttonInteraction, caseId) {
  const discordId = interaction.user.id;
  const username = interaction.user.username;
  const caseData = CASES[caseId];

  const checkInventory = await getInventory(discordId);
  const ownedCase = checkInventory.find(
    (item) => item.item_id === caseId && item.quantity > 0
  );

  if (!ownedCase) {
    return buttonInteraction.reply({
      content: "This vault is no longer available in your inventory.",
      ephemeral: true
    });
  }

  await buttonInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${caseData.icon} Vault Locked In`)
        .setDescription(
          [
            originLine(),
            "Preparing reward sequence.",
            originLine()
          ].join("\n")
        )
        .setColor(caseData.color)
        .setFooter({ text: `${BRAND.fullName} • Sequence starting` })
    ],
    components: []
  });

  const luck = await getLuckMultiplier(discordId);
  const finalReward = rollReward(caseId, luck);
  const totalSteps = 14;

  for (let step = 1; step <= totalSteps; step++) {
    const spinReward = step === totalSteps ? finalReward : getRandomReward(caseId);

    await sleep(step < 8 ? 220 : step < 12 ? 420 : 700);

    await interaction.editReply({
      embeds: [buildOpeningEmbed(caseData, spinReward, step, totalSteps)],
      components: []
    });
  }

  await removeItem(discordId, caseId);

  await addToJackpot(
    caseData.jackpotContribution || 500,
    discordId,
    username,
    "vault_open"
  );

  await applyReward(interaction, finalReward);

  if (await rollJackpotWin(0.5)) {
    const jackpotWin = await payJackpot(discordId, username);

    if (jackpotWin > 0) {
      finalReward.name = `${finalReward.name} + ${formatCurrency(jackpotWin)} Jackpot`;
      finalReward.rarity = "Legendary";
      finalReward.icon = "♚";
    }
  }

  await sleep(700);

  await interaction.editReply({
    embeds: [buildWinEmbed(caseData, finalReward)],
    components: [buildOpenAgainRow()]
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("open")
    .setDescription("Open your Origin vaults."),

  async execute(interaction) {
    const discordId = interaction.user.id;

    await interaction.reply({
      content: "Loading Origin Vault access...",
      fetchReply: true
    });

    const hasCases = await showCaseMenu(interaction, discordId);

    if (!hasCases) return;

    const message = await interaction.fetchReply();

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 180000
    });

    collector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.user.id !== interaction.user.id) {
        return buttonInteraction.reply({
          content: "This Origin Vault menu is not assigned to you.",
          ephemeral: true
        });
      }

      if (buttonInteraction.customId === "open_again") {
        await buttonInteraction.deferUpdate();
        return showCaseMenu(interaction, discordId);
      }

      const caseId = buttonInteraction.customId.replace("open_", "");

      if (!CASES[caseId]) {
        return buttonInteraction.reply({
          content: "This vault is no longer available.",
          ephemeral: true
        });
      }

      try {
        await openCase(interaction, buttonInteraction, caseId);
      } catch (error) {
        console.error("Open case error:", error);

        if (!buttonInteraction.replied && !buttonInteraction.deferred) {
          return buttonInteraction.reply({
            content: `Vault opening failed: ${error.message}`,
            ephemeral: true
          });
        }

        return interaction.editReply({
          content: `Vault opening failed: ${error.message}`,
          embeds: [],
          components: []
        });
      }
    });

    collector.on("end", async () => {
      try {
        await interaction.editReply({
          components: []
        });
      } catch (error) {
        console.error("Failed to disable open menu:", error);
      }
    });
  }
};