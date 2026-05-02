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

const COLORS = {
  Common: 0x9ca3af,
  Rare: 0x3b82f6,
  Epic: 0xa855f7,
  Legendary: 0xfacc15,
  Mythic: 0xff004c
};

const CASES = {
  basic_egg_case: {
    name: "Basic Egg Case",
    emoji: "📦",
    color: 0x3b82f6,
    rewards: [
      { type: "eggs", name: "100 Eggs", emoji: "🥚", amount: 100, chance: 40, rarity: "Common" },
      { type: "eggs", name: "300 Eggs", emoji: "🥚", amount: 300, chance: 25, rarity: "Common" },
      { type: "eggs", name: "700 Eggs", emoji: "🥚", amount: 700, chance: 15, rarity: "Rare" },
      { type: "eggs", name: "1,500 Eggs", emoji: "💰", amount: 1500, chance: 8, rarity: "Epic" },
      { type: "boost", name: "Double Eggs Boost", emoji: "⚡", boostId: "double_eggs_30m", chance: 7, rarity: "Rare" },
      { type: "role", name: "Egg Hunter Role", emoji: "🏹", roleName: "Egg Hunter", chance: 5, rarity: "Epic" }
    ]
  },

  golden_egg_case: {
    name: "Golden Egg Case",
    emoji: "💰",
    color: 0xfacc15,
    rewards: [
      { type: "eggs", name: "500 Eggs", emoji: "🥚", amount: 500, chance: 30, rarity: "Common" },
      { type: "eggs", name: "1,500 Eggs", emoji: "💰", amount: 1500, chance: 25, rarity: "Rare" },
      { type: "eggs", name: "3,000 Eggs", emoji: "💎", amount: 3000, chance: 18, rarity: "Epic" },
      { type: "eggs", name: "7,500 Eggs", emoji: "👑", amount: 7500, chance: 7, rarity: "Legendary" },
      { type: "boost", name: "Luck Boost", emoji: "🍀", boostId: "luck_boost_30m", chance: 12, rarity: "Epic" },
      { type: "role", name: "Golden Egg Role", emoji: "👑", roleName: "Golden Egg", chance: 8, rarity: "Legendary" }
    ]
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function progressBar(step, total) {
  const filled = Math.round((step / total) * 10);
  const empty = 10 - filled;
  return "🟨".repeat(filled) + "⬛".repeat(empty);
}

function rarityGlow(rarity) {
  if (rarity === "Mythic") return "🔴🔴🔴🔴🔴";
  if (rarity === "Legendary") return "🟨🟨🟨🟨🟨";
  if (rarity === "Epic") return "🟪🟪🟪🟪⬛";
  if (rarity === "Rare") return "🟦🟦🟦⬛⬛";
  return "⬜⬜⬛⬛⬛";
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
    .setTitle("📦 EggHub Case Vault")
    .setDescription("Choose a case below and open it with an animated reward reveal.")
    .setColor(0xffd700)
    .setFooter({ text: "EggHub Cases • Luck boosts improve rare reward chances" });

  for (const item of cases) {
    embed.addFields({
      name: `📦 ${item.item_name}`,
      value: `Owned: **${item.quantity}**`,
      inline: true
    });
  }

  return embed;
}

function buildOpeningEmbed(caseData, spinReward, step, total) {
  return new EmbedBuilder()
    .setTitle(`${caseData.emoji} Opening ${caseData.name}`)
    .setDescription(
      [
        "**Rolling reward...**",
        "",
        progressBar(step, total),
        "",
        `Current item: ${spinReward.emoji} **${spinReward.name}**`,
        `Rarity: **${spinReward.rarity}**`,
        rarityGlow(spinReward.rarity)
      ].join("\n")
    )
    .setColor(COLORS[spinReward.rarity] || caseData.color);
}

function buildWinEmbed(caseData, reward) {
  return new EmbedBuilder()
    .setTitle(`${reward.emoji} You Won!`)
    .setDescription(
      [
        `From: **${caseData.name}**`,
        "",
        `${reward.emoji} **${reward.name}**`,
        "",
        `Rarity: **${reward.rarity}**`,
        rarityGlow(reward.rarity)
      ].join("\n")
    )
    .setColor(COLORS[reward.rarity] || caseData.color)
    .setFooter({ text: "EggHub Cases • Reward added to your account" });
}

function buildOpenAgainRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("open_again")
      .setLabel("Open Another Case")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Success)
  );
}

function buildCaseButtons(cases) {
  const row = new ActionRowBuilder();

  for (const item of cases.slice(0, 5)) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`open_${item.item_id}`)
        .setLabel(`${item.item_name} x${item.quantity}`)
        .setEmoji("📦")
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

async function addEggs(discordId, amount) {
  await pool.query(
    "UPDATE users SET eggs = eggs + $1 WHERE discord_id = $2",
    [amount, discordId]
  );
}

async function activateBoost(discordId, reward) {
  const boostData = {
    double_eggs_30m: {
      name: "Double Eggs Boost",
      multiplier: 2,
      durationMinutes: 30
    },
    luck_boost_30m: {
      name: "Luck Boost",
      multiplier: 1.25,
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

  if (reward.type === "eggs") {
    await addEggs(discordId, reward.amount);
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
      content: "❌ You have no cases to open. Buy one from `/shop` first.",
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
  const caseData = CASES[caseId];

  const checkInventory = await getInventory(discordId);
  const ownedCase = checkInventory.find(
    (item) => item.item_id === caseId && item.quantity > 0
  );

  if (!ownedCase) {
    return buttonInteraction.reply({
      content: "❌ You do not have this case anymore.",
      ephemeral: true
    });
  }

  await buttonInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setTitle(`${caseData.emoji} Case Locked In`)
        .setDescription("Preparing your reward roll...")
        .setColor(caseData.color)
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
  await applyReward(interaction, finalReward);

  await sleep(700);

  await interaction.editReply({
    embeds: [buildWinEmbed(caseData, finalReward)],
    components: [buildOpenAgainRow()]
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("open")
    .setDescription("Open your EggHub cases."),

  async execute(interaction) {
    const discordId = interaction.user.id;

    await interaction.reply({
      content: "📦 Loading your case vault...",
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
          content: "❌ This case menu is not yours.",
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
          content: "❌ This case no longer exists.",
          ephemeral: true
        });
      }

      try {
        await openCase(interaction, buttonInteraction, caseId);
      } catch (error) {
        console.error("Open case error:", error);

        if (!buttonInteraction.replied && !buttonInteraction.deferred) {
          return buttonInteraction.reply({
            content: `❌ Case opening failed: ${error.message}`,
            ephemeral: true
          });
        }

        return interaction.editReply({
          content: `❌ Case opening failed: ${error.message}`,
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