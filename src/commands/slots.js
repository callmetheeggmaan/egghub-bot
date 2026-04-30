const {
  SlashCommandBuilder,
  EmbedBuilder,
} = require("discord.js");

const pool = require("../db/pool");

const MIN_BET = 10;
const MAX_BET = 1000;
const COOLDOWN_MS = 5000;

const activeSlots = new Set();

const SYMBOLS = [
  "🍒",
  "🍋",
  "🍊",
  "🍇",
  "🔔",
  "⭐",
  "💎",
  "🥚",
];

const PAYOUTS = {
  "💎": 12,
  "🥚": 8,
  "⭐": 6,
  "🔔": 5,
  "🍇": 4,
  "🍊": 3,
  "🍋": 2,
  "🍒": 2,
};

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomSymbol() {
  return SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
}

function spinRow() {
  return [randomSymbol(), randomSymbol(), randomSymbol()];
}

function spinGrid() {
  return [spinRow(), spinRow(), spinRow()];
}

function formatGrid(grid) {
  return (
    "```txt\n" +
    "╔═══════════════╗\n" +
    `║  ${grid[0].join("  ")}  ║\n` +
    `║▶ ${grid[1].join("  ")} ◀║\n` +
    `║  ${grid[2].join("  ")}  ║\n` +
    "╚═══════════════╝\n" +
    "```"
  );
}

function calculateResult(grid, bet) {
  const middle = grid[1];
  const [a, b, c] = middle;

  if (a === b && b === c) {
    const multiplier = PAYOUTS[a] || 2;
    const win = bet * multiplier;

    if (a === "💎") {
      return {
        win,
        type: "jackpot",
        label: `💎 DIAMOND JACKPOT! x${multiplier}`,
      };
    }

    if (a === "🥚") {
      return {
        win,
        type: "eggpot",
        label: `🥚 EGG POT! x${multiplier}`,
      };
    }

    return {
      win,
      type: "bigwin",
      label: `${a} THREE OF A KIND! x${multiplier}`,
    };
  }

  if (a === b || b === c || a === c) {
    return {
      win: Math.floor(bet * 1.5),
      type: "smallwin",
      label: "✨ TWO MATCHED! x1.5",
    };
  }

  const unique = new Set(middle);

  if (unique.size === 3) {
    return {
      win: 0,
      type: "loss",
      label: "❌ NO MATCH",
    };
  }

  return {
    win: 0,
    type: "loss",
    label: "❌ NO MATCH",
  };
}

function buildEmbed({
  grid,
  bet,
  win,
  status,
  resultLabel,
  balance,
  spinText,
}) {
  let color = 0xf1c40f;
  let title = "🎰 EGGHUB FRUIT MACHINE";
  let footer = "Match the middle row to win.";

  if (status === "spinning") {
    color = 0x3498db;
    title = "🎰 SPINNING...";
    footer = "The reels are rolling...";
  }

  if (status === "loss") {
    color = 0xe74c3c;
    title = "💀 NO WIN";
    footer = "Try again.";
  }

  if (status === "smallwin") {
    color = 0x2ecc71;
    title = "✅ SMALL WIN";
    footer = "A win is a win.";
  }

  if (status === "bigwin") {
    color = 0x9b59b6;
    title = "🔥 BIG WIN";
    footer = "Three of a kind.";
  }

  if (status === "eggpot") {
    color = 0xf1c40f;
    title = "🥚 EGG POT";
    footer = "EggHub special win.";
  }

  if (status === "jackpot") {
    color = 0x00ffff;
    title = "💎 JACKPOT";
    footer = "Massive hit.";
  }

  let description =
    `${formatGrid(grid)}\n` +
    `**${spinText || resultLabel || "Pulling the lever..."}**\n\n` +
    `🥚 **Bet:** ${bet} Eggs\n` +
    `💰 **Win:** ${win} Eggs`;

  if (typeof balance === "number") {
    description += `\n🏦 **Balance:** ${balance} Eggs`;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: footer });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Play the EggHub fruit machine")
    .addIntegerOption(option =>
      option
        .setName("bet")
        .setDescription("Amount of Eggs to bet")
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const bet = interaction.options.getInteger("bet");

    if (activeSlots.has(userId)) {
      return interaction.reply({
        content: "You already have a slot spin running.",
        ephemeral: true,
      });
    }

    if (bet < MIN_BET || bet > MAX_BET) {
      return interaction.reply({
        content: `Bet must be between ${MIN_BET} and ${MAX_BET} Eggs.`,
        ephemeral: true,
      });
    }

    activeSlots.add(userId);

    try {
      const userResult = await pool.query(
        "SELECT eggs FROM users WHERE discord_id = $1",
        [userId]
      );

      const currentEggs = Number(userResult.rows[0]?.eggs || 0);

      if (currentEggs < bet) {
        activeSlots.delete(userId);

        return interaction.reply({
          content: `You only have ${currentEggs} Eggs.`,
          ephemeral: true,
        });
      }

      const removeBet = await pool.query(
        `
        UPDATE users
        SET eggs = eggs - $1, username = $2
        WHERE discord_id = $3 AND eggs >= $1
        RETURNING eggs
        `,
        [bet, username, userId]
      );

      if (removeBet.rows.length === 0) {
        activeSlots.delete(userId);

        return interaction.reply({
          content: "You do not have enough Eggs for that bet.",
          ephemeral: true,
        });
      }

      let grid = spinGrid();

      await interaction.reply({
        embeds: [
          buildEmbed({
            grid,
            bet,
            win: 0,
            status: "spinning",
            spinText: "🎲 Pulling the lever...",
          }),
        ],
      });

      const message = await interaction.fetchReply();

      await wait(500);
      grid = spinGrid();
      await message.edit({
        embeds: [
          buildEmbed({
            grid,
            bet,
            win: 0,
            status: "spinning",
            spinText: "🔄 Reel 1 spinning...",
          }),
        ],
      });

      await wait(600);
      grid = spinGrid();
      await message.edit({
        embeds: [
          buildEmbed({
            grid,
            bet,
            win: 0,
            status: "spinning",
            spinText: "🔄 Reel 2 spinning...",
          }),
        ],
      });

      await wait(700);
      grid = spinGrid();
      await message.edit({
        embeds: [
          buildEmbed({
            grid,
            bet,
            win: 0,
            status: "spinning",
            spinText: "🔄 Final reel slowing down...",
          }),
        ],
      });

      await wait(800);

      const finalGrid = spinGrid();
      const result = calculateResult(finalGrid, bet);

      let finalBalance = Number(removeBet.rows[0].eggs);

      if (result.win > 0) {
        const payout = await pool.query(
          `
          UPDATE users
          SET eggs = eggs + $1, username = $2
          WHERE discord_id = $3
          RETURNING eggs
          `,
          [result.win, username, userId]
        );

        finalBalance = Number(payout.rows[0]?.eggs || finalBalance);
      }

      await message.edit({
        embeds: [
          buildEmbed({
            grid: finalGrid,
            bet,
            win: result.win,
            status: result.type,
            resultLabel: result.label,
            balance: finalBalance,
          }),
        ],
      });

      setTimeout(() => {
        activeSlots.delete(userId);
      }, COOLDOWN_MS);
    } catch (err) {
      console.error("Slots error:", err);
      activeSlots.delete(userId);

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({
          content: "Slots failed.",
          ephemeral: true,
        }).catch(() => null);
      }

      return interaction.reply({
        content: "Slots failed.",
        ephemeral: true,
      }).catch(() => null);
    }
  },
};