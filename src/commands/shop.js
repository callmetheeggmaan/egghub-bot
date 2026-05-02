const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require("discord.js");

const pool = require("../db/pool");
const { SHOP_ITEMS } = require("../shop/shopItems");

function formatItemLine(item) {
  return `${item.emoji} **${item.name}**\n${item.description}\nPrice: **${item.price.toLocaleString()} Eggs**`;
}

function getCategoryItems(category) {
  if (category === "all") return SHOP_ITEMS;
  return SHOP_ITEMS.filter((item) => item.category === category);
}

function buildShopEmbed(category = "all") {
  const categoryItems = getCategoryItems(category);

  return new EmbedBuilder()
    .setTitle("🥚 EggHub Shop")
    .setDescription(
      categoryItems.length
        ? categoryItems.map(formatItemLine).join("\n\n")
        : "No items found in this category."
    )
    .setColor(0xffd700)
    .setFooter({
      text: "Use the menu to change category. Use buttons to buy items."
    });
}

function buildCategoryRow(selected = "all") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("shop_category")
      .setPlaceholder("Choose a shop category")
      .addOptions([
        {
          label: "All Items",
          value: "all",
          emoji: "🛒",
          default: selected === "all"
        },
        {
          label: "Boosts",
          value: "boosts",
          emoji: "⚡",
          default: selected === "boosts"
        },
        {
          label: "Loot Boxes",
          value: "cases",
          emoji: "📦",
          default: selected === "cases"
        },
        {
          label: "Roles",
          value: "roles",
          emoji: "🎭",
          default: selected === "roles"
        }
      ])
  );
}

function buildBuyRows(category = "all") {
  const items = getCategoryItems(category).slice(0, 5);

  const row = new ActionRowBuilder();

  for (const item of items) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_buy_${item.id}`)
        .setLabel(`Buy ${item.name}`)
        .setEmoji(item.emoji)
        .setStyle(ButtonStyle.Success)
    );
  }

  return [row];
}

async function getUserEggs(discordId, username) {
  const result = await pool.query(
    "SELECT eggs FROM users WHERE discord_id = $1",
    [discordId]
  );

  if (result.rows.length === 0) {
    await pool.query(
      "INSERT INTO users (discord_id, username, eggs) VALUES ($1, $2, $3)",
      [discordId, username, 0]
    );

    return 0;
  }

  return Number(result.rows[0].eggs || 0);
}

async function removeEggs(discordId, amount) {
  await pool.query(
    "UPDATE users SET eggs = eggs - $1 WHERE discord_id = $2",
    [amount, discordId]
  );
}

async function addInventoryItem(discordId, item) {
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
    [discordId, item.id, item.name, item.type]
  );
}

async function activateBoost(discordId, item) {
  const expiresAt = new Date(Date.now() + item.durationMinutes * 60 * 1000);

  await pool.query(
    `
    INSERT INTO active_boosts
    (discord_id, boost_id, boost_name, multiplier, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [discordId, item.id, item.name, item.multiplier, expiresAt]
  );
}

async function logPurchase(discordId, item) {
  await pool.query(
    `
    INSERT INTO shop_purchases
    (discord_id, item_id, item_name, item_type, price)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [discordId, item.id, item.name, item.type, item.price]
  );
}

async function giveRole(interaction, item) {
  if (!item.roleName) return;

  const role = interaction.guild.roles.cache.find(
    (serverRole) => serverRole.name.toLowerCase() === item.roleName.toLowerCase()
  );

  if (!role) {
    throw new Error(`The role "${item.roleName}" does not exist in this server.`);
  }

  await interaction.member.roles.add(role);
}

async function handlePurchase(interaction, item) {
  const discordId = interaction.user.id;
  const username = interaction.user.username;

  const eggs = await getUserEggs(discordId, username);

  if (eggs < item.price) {
    return interaction.reply({
      content: `❌ You need **${item.price.toLocaleString()} Eggs**, but you only have **${eggs.toLocaleString()} Eggs**.`,
      ephemeral: true
    });
  }

  await removeEggs(discordId, item.price);

  if (item.type === "boost") {
    await activateBoost(discordId, item);
  }

  if (item.type === "case") {
    await addInventoryItem(discordId, item);
  }

  if (item.type === "role") {
    await giveRole(interaction, item);
    await addInventoryItem(discordId, item);
  }

  await logPurchase(discordId, item);

  return interaction.reply({
    content: `✅ You bought ${item.emoji} **${item.name}** for **${item.price.toLocaleString()} Eggs**.`,
    ephemeral: true
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Open the EggHub shop."),

  async execute(interaction) {
    let currentCategory = "all";

    const message = await interaction.reply({
      embeds: [buildShopEmbed(currentCategory)],
      components: [
        buildCategoryRow(currentCategory),
        ...buildBuyRows(currentCategory)
      ],
      fetchReply: true
    });

    const selectCollector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120000
    });

    const buttonCollector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000
    });

    selectCollector.on("collect", async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) {
        return selectInteraction.reply({
          content: "❌ This shop menu is not yours.",
          ephemeral: true
        });
      }

      currentCategory = selectInteraction.values[0];

      await selectInteraction.update({
        embeds: [buildShopEmbed(currentCategory)],
        components: [
          buildCategoryRow(currentCategory),
          ...buildBuyRows(currentCategory)
        ]
      });
    });

    buttonCollector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.user.id !== interaction.user.id) {
        return buttonInteraction.reply({
          content: "❌ This shop menu is not yours.",
          ephemeral: true
        });
      }

      const itemId = buttonInteraction.customId.replace("shop_buy_", "");
      const item = SHOP_ITEMS.find((shopItem) => shopItem.id === itemId);

      if (!item) {
        return buttonInteraction.reply({
          content: "❌ This shop item no longer exists.",
          ephemeral: true
        });
      }

      try {
        await handlePurchase(buttonInteraction, item);
      } catch (error) {
        console.error("Shop purchase error:", error);

        if (buttonInteraction.replied || buttonInteraction.deferred) {
          return;
        }

        return buttonInteraction.reply({
          content: `❌ Purchase failed: ${error.message}`,
          ephemeral: true
        });
      }
    });

    selectCollector.on("end", async () => {
      try {
        await interaction.editReply({
          components: []
        });
      } catch (error) {
        console.error("Failed to disable shop menu:", error);
      }
    });
  }
};