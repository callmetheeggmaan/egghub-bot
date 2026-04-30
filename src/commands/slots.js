const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

const pool = require("../db/pool");

const MIN_BET = 10;
const MAX_BET = 1000;

const symbols = ["🥚", "💰", "🔥", "💎", "🍀"];

function spin() {
  return [
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];
}

function calculateWin(result, bet) {
  const [a, b, c] = result;

  if (a === b && b === c) {
    if (a === "💎") return bet * 10;
    if (a === "🔥") return bet * 6;
    if (a === "💰") return bet * 4;
    if (a === "🍀") return bet * 3;
    return bet * 2;
  }

  if (a === b || b === c || a === c) {
    return Math.floor(bet * 1.5);
  }

  return 0;
}

function buildEmbed(result, bet, win, status) {
  let color = 0xf1c40f;
  let title = "🎰 EGGHUB SLOTS";

  if (status === "win") color = 0x2ecc71;
  if (status === "lose") color = 0xe74c3c;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      `\n🎰 **${result.join("  |  ")}**\n\n` +
      `🥚 Bet: **${bet}**\n` +
      `💰 Win: **${win}**\n\n` +
      (status === "spin" ? "Spinning..." :
       win > 0 ? "🎉 You win!" :
       "❌ You lost")
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Play the slot machine")
    .addIntegerOption(option =>
      option
        .setName("bet")
        .setDescription("Amount to bet")
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const bet = interaction.options.getInteger("bet");

    if (bet < MIN_BET || bet > MAX_BET) {
      return interaction.reply({
        content: `Bet must be between ${MIN_BET} and ${MAX_BET}.`,
        ephemeral: true,
      });
    }

    try {
      const result = await pool.query(
        "SELECT eggs FROM users WHERE discord_id = $1",
        [userId]
      );

      const currentEggs = Number(result.rows[0]?.eggs || 0);

      if (currentEggs < bet) {
        return interaction.reply({
          content: `You only have ${currentEggs} Eggs.`,
          ephemeral: true,
        });
      }

      // remove bet
      await pool.query(
        "UPDATE users SET eggs = eggs - $1 WHERE discord_id = $2",
        [bet, userId]
      );

      // fake spin animation (3 edits)
      let spin1 = spin();
      let spin2 = spin();
      let finalSpin = spin();

      await interaction.reply({
        embeds: [buildEmbed(spin1, bet, 0, "spin")],
      });

      const message = await interaction.fetchReply();

      await new Promise(r => setTimeout(r, 400));
      await message.edit({ embeds: [buildEmbed(spin2, bet, 0, "spin")] });

      await new Promise(r => setTimeout(r, 400));

      const win = calculateWin(finalSpin, bet);

      if (win > 0) {
        await pool.query(
          "UPDATE users SET eggs = eggs + $1, username = $2 WHERE discord_id = $3",
          [win, username, userId]
        );
      }

      await message.edit({
        embeds: [buildEmbed(finalSpin, bet, win, win > 0 ? "win" : "lose")],
      });

    } catch (err) {
      console.error("Slots error:", err);

      if (interaction.replied) {
        return interaction.followUp({
          content: "Slots failed.",
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: "Slots failed.",
        ephemeral: true,
      });
    }
  },
};