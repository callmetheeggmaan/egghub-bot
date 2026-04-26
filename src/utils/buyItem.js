const pool = require("../db/pool");

module.exports = async (interaction, itemKey) => {
  const userId = interaction.user.id;

  const ITEMS = {
    golden: {
      type: "role",
      name: "Golden Egg Role",
      cost: 1000,
      role: process.env.GOLDEN_ROLE_ID,
      durationDays: 7,
    },

    mystery: {
      type: "mystery",
      name: "Mystery Egg",
      cost: 120,
    },
  };

  const item = ITEMS[itemKey];

  if (!item) {
    return interaction.reply({
      content: "Invalid item.",
      ephemeral: true,
    });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE discord_id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return interaction.reply({
        content: "You have no Eggs yet.",
        ephemeral: true,
      });
    }

    const user = result.rows[0];

    if (user.eggs < item.cost) {
      return interaction.reply({
        content: `You need ${item.cost} Eggs. You currently have ${user.eggs}.`,
        ephemeral: true,
      });
    }

    // Golden Egg role purchase
    if (item.type === "role") {
      const active = await pool.query(
        "SELECT * FROM user_roles WHERE discord_id = $1 AND role_id = $2 AND expires_at > NOW()",
        [userId, item.role]
      );

      if (active.rows.length > 0) {
        const expires = new Date(active.rows[0].expires_at);

        return interaction.reply({
          content: `You already own ${item.name}. Expires: ${expires.toLocaleString()}.`,
          ephemeral: true,
        });
      }

      const member = await interaction.guild.members.fetch(userId);
      await member.roles.add(item.role);

      const expiresAt = new Date(
        Date.now() + item.durationDays * 24 * 60 * 60 * 1000
      );

      await pool.query(
        "INSERT INTO user_roles (discord_id, role_id, expires_at) VALUES ($1, $2, $3)",
        [userId, item.role, expiresAt]
      );

      await pool.query(
        "UPDATE users SET eggs = eggs - $1 WHERE discord_id = $2",
        [item.cost, userId]
      );

      return interaction.reply({
        content: `✨ Bought **${item.name}** for ${item.cost} Eggs. It lasts ${item.durationDays} days.`,
        ephemeral: true,
      });
    }

    // Mystery Egg purchase
    if (item.type === "mystery") {
      const rewards = [
        { label: "Common", amount: 20, chance: 40, emoji: "⚪" },
        { label: "Uncommon", amount: 50, chance: 30, emoji: "🟢" },
        { label: "Rare", amount: 100, chance: 20, emoji: "🔵" },
        { label: "Epic", amount: 250, chance: 8, emoji: "🟣" },
        { label: "LEGENDARY JACKPOT", amount: 500, chance: 2, emoji: "🟡🔥" },
      ];

      const roll = Math.random() * 100;
      let total = 0;
      let reward = rewards[0];

      for (const possibleReward of rewards) {
        total += possibleReward.chance;

        if (roll <= total) {
          reward = possibleReward;
          break;
        }
      }

      await pool.query(
        "UPDATE users SET eggs = eggs - $1 + $2 WHERE discord_id = $3",
        [item.cost, reward.amount, userId]
      );

      if (reward.label === "LEGENDARY JACKPOT") {
        return interaction.reply(
          `🔥🔥 **JACKPOT WIN** 🔥🔥\n${interaction.user.username} opened a **Mystery Egg** and won **${reward.amount} Eggs**!`
        );
      }

      return interaction.reply({
        content: `${reward.emoji} Mystery Egg opened → **${reward.label}** reward: +${reward.amount} Eggs`,
        ephemeral: true,
      });
    }
  } catch (err) {
    console.error("Buy item error:", err);

    return interaction.reply({
      content: "Purchase failed.",
      ephemeral: true,
    });
  }
};