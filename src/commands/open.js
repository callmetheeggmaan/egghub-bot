const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

const pool = require("../db/pool");

// Simple loot tables
const CASES = {
  basic_egg_case: [
    { type: "eggs", amount: 100, chance: 50 },
    { type: "eggs", amount: 300, chance: 30 },
    { type: "eggs", amount: 700, chance: 10 },
    { type: "boost", id: "double_eggs_30m", chance: 5 },
    { type: "role", roleName: "Egg Hunter", chance: 5 }
  ],
  golden_egg_case: [
    { type: "eggs", amount: 500, chance: 40 },
    { type: "eggs", amount: 1500, chance: 30 },
    { type: "eggs", amount: 3000, chance: 15 },
    { type: "boost", id: "luck_boost_30m", chance: 10 },
    { type: "role", roleName: "Golden Egg", chance: 5 }
  ]
};

function rollReward(caseId) {
  const rewards = CASES[caseId];
  const roll = Math.random() * 100;

  let cumulative = 0;

  for (const reward of rewards) {
    cumulative += reward.chance;
    if (roll <= cumulative) return reward;
  }

  return rewards[0];
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
    SET quantity = quantity - 1
    WHERE discord_id = $1 AND item_id = $2
    `,
    [discordId, itemId]
  );

  await pool.query(
    `
    DELETE FROM user_inventory
    WHERE discord_id = $1 AND item_id = $2 AND quantity <= 0
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

async function giveRole(interaction, roleName) {
  const role = interaction.guild.roles.cache.find(
    (r) => r.name.toLowerCase() === roleName.toLowerCase()
  );

  if (!role) throw new Error("Role not found");

  await interaction.member.roles.add(role);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("open")
    .setDescription("Open your loot cases"),

  async execute(interaction) {
    const discordId = interaction.user.id;

    const inventory = await getInventory(discordId);
    const cases = inventory.filter((i) => i.item_type === "case");

    if (cases.length === 0) {
      return interaction.reply("❌ You have no cases to open.");
    }

    const row = new ActionRowBuilder();

    cases.slice(0, 5).forEach((item) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`open_${item.item_id}`)
          .setLabel(`${item.item_name} (${item.quantity})`)
          .setStyle(ButtonStyle.Primary)
      );
    });

    const message = await interaction.reply({
      content: "📦 Choose a case to open:",
      components: [row],
      fetchReply: true
    });

    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000
    });

    collector.on("collect", async (btn) => {
      if (btn.user.id !== interaction.user.id) {
        return btn.reply({
          content: "❌ Not your menu.",
          ephemeral: true
        });
      }

      const caseId = btn.customId.replace("open_", "");

      const reward = rollReward(caseId);

      await removeItem(discordId, caseId);

      let resultText = "";

      if (reward.type === "eggs") {
        await addEggs(discordId, reward.amount);
        resultText = `🥚 You won **${reward.amount} Eggs!**`;
      }

      if (reward.type === "role") {
        await giveRole(interaction, reward.roleName);
        resultText = `🎭 You unlocked **${reward.roleName}**!`;
      }

      if (reward.type === "boost") {
        resultText = `⚡ You won a **boost!** (hook into boost system later)`;
      }

      const embed = new EmbedBuilder()
        .setTitle("📦 Case Opened")
        .setDescription(resultText)
        .setColor(0xffd700);

      await btn.update({
        embeds: [embed],
        components: []
      });
    });
  }
};