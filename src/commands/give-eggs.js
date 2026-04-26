const { SlashCommandBuilder } = require("discord.js");
const pool = require("../db/pool");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("give-eggs")
    .setDescription("Give Eggs to another user")
    .addUserOption(option =>
      option.setName("user")
        .setDescription("User to give Eggs to")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName("amount")
        .setDescription("Amount of Eggs")
        .setRequired(true)
    ),

  async execute(interaction) {
    const senderId = interaction.user.id;
    const senderName = interaction.user.username;

    const target = interaction.options.getUser("user");
    const amount = interaction.options.getInteger("amount");

    if (target.bot) {
      return interaction.reply("You cannot give Eggs to bots.");
    }

    if (amount <= 0) {
      return interaction.reply("Amount must be greater than 0.");
    }

    try {
      // Get sender
      const senderResult = await pool.query(
        "SELECT * FROM users WHERE discord_id = $1",
        [senderId]
      );

      if (senderResult.rows.length === 0) {
        return interaction.reply("You have no Eggs to give.");
      }

      const sender = senderResult.rows[0];

      if (sender.eggs < amount) {
        return interaction.reply("You don’t have enough Eggs.");
      }

      // Deduct from sender
      await pool.query(
        "UPDATE users SET eggs = eggs - $1 WHERE discord_id = $2",
        [amount, senderId]
      );

      // Add to receiver (create if needed)
      await pool.query(
        `
        INSERT INTO users (discord_id, username, eggs)
        VALUES ($1, $2, $3)
        ON CONFLICT (discord_id)
        DO UPDATE SET
          eggs = users.eggs + $3,
          username = EXCLUDED.username
        `,
        [target.id, target.username, amount]
      );

      await interaction.reply(
        `🥚 You gave ${amount} Eggs to ${target.username}`
      );

    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: "Database error",
        ephemeral: true,
      });
    }
  },
};