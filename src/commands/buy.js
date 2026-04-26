const { SlashCommandBuilder } = require("discord.js");
const pool = require("../db/pool");

const ITEMS = {
  golden: {
    name: "Golden Egg Role",
    cost: 5,
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("buy")
    .setDescription("Buy an item from the shop")
    .addStringOption(option =>
      option.setName("item")
        .setDescription("Item to buy (golden)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const itemKey = interaction.options.getString("item");
    const item = ITEMS[itemKey];

    if (!item) {
      return interaction.reply("Invalid item.");
    }

    try {
      const result = await pool.query(
        "SELECT * FROM users WHERE discord_id = $1",
        [userId]
      );

      if (result.rows.length === 0) {
        return interaction.reply("You have no Eggs.");
      }

      const user = result.rows[0];

      if (user.eggs < item.cost) {
        return interaction.reply(`You need ${item.cost} Eggs.`);
      }

      if (itemKey === "golden") {
        const roleId = process.env.GOLDEN_ROLE_ID;

        const activeRole = await pool.query(
          "SELECT * FROM user_roles WHERE discord_id = $1 AND role_id = $2 AND expires_at > NOW()",
          [userId, roleId]
        );

        if (activeRole.rows.length > 0) {
          const expiresAt = new Date(activeRole.rows[0].expires_at);
          return interaction.reply(
            `You already own ${item.name}. It expires on ${expiresAt.toLocaleString()}.`
          );
        }

        const member = await interaction.guild.members.fetch(userId);
        await member.roles.add(roleId);

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await pool.query(
          "INSERT INTO user_roles (discord_id, role_id, expires_at) VALUES ($1, $2, $3)",
          [userId, roleId, expiresAt]
        );
      }

      await pool.query(
        "UPDATE users SET eggs = eggs - $1 WHERE discord_id = $2",
        [item.cost, userId]
      );

      await interaction.reply(`✅ You bought ${item.name}. It lasts 7 days.`);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Purchase failed",
        ephemeral: true,
      });
    }
  },
};