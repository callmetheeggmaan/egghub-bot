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
const { BRAND, formatCurrency, originLine } = require("../config/brand");

const COLORS = {
  Common: 0x8a8a8a,
  Rare: 0x3b82f6,
  Epic: 0x8b5cf6,
  Legendary: BRAND.colour
};

function getCategoryItems(category) {
  if (category === "all") return SHOP_ITEMS;
  return SHOP_ITEMS.filter((item) => item.category === category);
}

function rarityLine(rarity) {
  if (rarity === "Legendary") return "GOLD TIER";
  if (rarity === "Epic") return "ELITE TIER";
  if (rarity === "Rare") return "RARE TIER";
  return "STANDARD TIER";
}

function buildShopEmbed(category = "all") {
  const items = getCategoryItems(category);

  const categoryName = {
    all: "All Items",
    boosts: "Boosts",
    cases: "Vault Cases",
    roles: "Origin Roles"
  }[category];

  const embed = new EmbedBuilder()
    .setTitle(`${BRAND.name} Vault`)
    .setDescription(
      [
        originLine(),
        `**Category:** ${categoryName}`,
        "",
        `Premium items, boosts and vault cases bought with ${BRAND.currencyName}.`,
        "Use the selector below to browse. Use the buttons to purchase.",
        originLine()
      ].join("\n")
    )
    .setColor(BRAND.colour)
    .setFooter({ text: `${BRAND.fullName} • ${BRAND.tagline}` });

  for (const item of items.slice(0, 6)) {
    embed.addFields({
      name: `${item.emoji} ${item.name} — ${formatCurrency(item.price)}`,
      value: [
        item.description,
        `Tier: **${rarityLine(item.rarity)}**`
      ].join("\n"),
      inline: false
    });
  }

  return embed;
}

function buildCategoryRow(selected = "all") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("shop_category")
      .setPlaceholder("Browse Origin Vault")
      .addOptions([
        {
          label: "All Items",
          value: "all",
          description: "View the full Origin Vault",
          default: selected === "all"
        },
        {
          label: "Boosts",
          value: "boosts",
          description: "Multiplier and luck upgrades",
          default: selected === "boosts"
        },
        {
          label: "Vault Cases",
          value: "cases",
          description: "Premium cases and rewards",
          default: selected === "cases"
        },
        {
          label: "Origin Roles",
          value: "roles",
          description: "Exclusive status roles",
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
        .setLabel(formatCurrency(item.price))
        .setStyle(
          item.rarity === "Legendary"
            ? ButtonStyle.Danger
            : item.rarity === "Epic"
              ? ButtonStyle.Primary
              : ButtonStyle.Success
        )
    );
  }

  return [row];
}

async function getUserBalance(discordId, username) {
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

async function removeBalance(discordId, amount) {
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
  const balance = await getUserBalance(discordId, username);

  if (balance < item.price) {
    return interaction.reply({
      content: `Insufficient balance. Required: **${formatCurrency(item.price)}**. Current: **${formatCurrency(balance)}**.`,
      ephemeral: true
    });
  }

  await removeBalance(discordId, item.price);

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

  const successEmbed = new EmbedBuilder()
    .setTitle("Purchase Complete")
    .setDescription(
      [
        originLine(),
        `**Item:** ${item.emoji} ${item.name}`,
        `**Price:** ${formatCurrency(item.price)}`,
        `**Tier:** ${rarityLine(item.rarity)}`,
        originLine()
      ].join("\n")
    )
    .setColor(COLORS[item.rarity] || BRAND.colour)
    .setFooter({ text: `${BRAND.fullName} • Transaction confirmed` });

  return interaction.reply({
    embeds: [successEmbed],
    ephemeral: true
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("shop")
    .setDescription("Open the Origin Vault."),

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
      time: 180000
    });

    const buttonCollector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 180000
    });

    selectCollector.on("collect", async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) {
        return selectInteraction.reply({
          content: "This Origin Vault menu is not assigned to you.",
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
          content: "This Origin Vault menu is not assigned to you.",
          ephemeral: true
        });
      }

      const itemId = buttonInteraction.customId.replace("shop_buy_", "");
      const item = SHOP_ITEMS.find((shopItem) => shopItem.id === itemId);

      if (!item) {
        return buttonInteraction.reply({
          content: "This Origin Vault item is no longer available.",
          ephemeral: true
        });
      }

      try {
        await handlePurchase(buttonInteraction, item);
      } catch (error) {
        console.error("Shop purchase error:", error);

        if (buttonInteraction.replied || buttonInteraction.deferred) return;

        return buttonInteraction.reply({
          content: `Purchase failed: ${error.message}`,
          ephemeral: true
        });
      }
    });

    selectCollector.on("end", async () => {
      try {
        await interaction.editReply({ components: [] });
      } catch (error) {
        console.error("Failed to disable shop menu:", error);
      }
    });
  }
};