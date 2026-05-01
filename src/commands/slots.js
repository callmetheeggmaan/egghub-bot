const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

const MIN_BET = 10;
const MAX_BET = 1000;
const SPIN_FRAME_MS = 350;
const activeSlots = new Set();

const SYMBOLS = ["🍒", "🍋", "🍊", "🍇", "🔔", "⭐", "💎", "🥚"];

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

function spinGrid() {
  return [
    [randomSymbol(), randomSymbol(), randomSymbol()],
    [randomSymbol(), randomSymbol(), randomSymbol()],
    [randomSymbol(), randomSymbol(), randomSymbol()],
  ];
}

function formatGrid(grid) {
  return (
    "```txt\n" +
    "┏━━━━━━━━━━━━━━━┓\n" +
    `┃   ${grid[0][0]}   ${grid[0][1]}   ${grid[0][2]}   ┃\n` +
    "┣━━━━━━━━━━━━━━━┫\n" +
    `┃▶  ${grid[1][0]}   ${grid[1][1]}   ${grid[1][2]}  ◀┃\n` +
    "┣━━━━━━━━━━━━━━━┫\n" +
    `┃   ${grid[2][0]}   ${grid[2][1]}   ${grid[2][2]}   ┃\n` +
    "┗━━━━━━━━━━━━━━━┛\n" +
    "```"
  );
}

function calculateResult(grid, bet) {
  const [a, b, c] = grid[1];

  if (a === b && b === c) {
    const multiplier = PAYOUTS[a] || 2;
    return {
      win: bet * multiplier,
      type: a === "💎" ? "jackpot" : "bigwin",
      label: a === "💎"
        ? `💎 JACKPOT HIT x${multiplier}`
        : `${a} THREE OF A KIND x${multiplier}`,
    };
  }

  if (a === b || b === c || a === c) {
    return {
      win: Math.floor(bet * 1.5),
      type: "smallwin",
      label: "✨ TWO SYMBOLS MATCHED x1.5",
    };
  }

  return {
    win: 0,
    type: "loss",
    label: "❌ NO WIN",
  };
}

function makeButtons(userId, state = "ended") {
  if (state === "spinning") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`slots_spinning_${userId}`)
          .setLabel("SPINNING")
          .setEmoji("🎰")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`slots_again_${userId}`)
        .setLabel("SPIN AGAIN")
        .setEmoji("🔁")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`slots_done_${userId}`)
        .setLabel("DONE")
        .setEmoji("🛑")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function buildEmbed({ grid, bet, win, status, label, balance }) {
  let color = 0xf1c40f;
  let title = "🎰 EGGHUB SLOTS";
  let headline = "Pulling the lever...";

  if (status === "spinning") {
    color = 0x3498db;
    title = "🎰 SPINNING";
    headline = "Reels are rolling...";
  }

  if (status === "loss") {
    color = 0xe74c3c;
    title = "💀 NO WIN";
    headline = label;
  }

  if (status === "smallwin") {
    color = 0x2ecc71;
    title = "✅ SMALL WIN";
    headline = label;
  }

  if (status === "bigwin") {
    color = 0x9b59b6;
    title = "🔥 BIG WIN";
    headline = label;
  }

  if (status === "jackpot") {
    color = 0x00ffff;
    title = "💎 JACKPOT";
    headline = label;
  }

  let description =
    `${formatGrid(grid)}\n` +
    `**${headline}**\n\n` +
    `🥚 **Bet:** ${bet} Eggs\n` +
    `💰 **Win:** ${win} Eggs`;

  if (typeof balance === "number") {
    description += `\n🏦 **Balance:** ${balance} Eggs`;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Middle row pays." });
}

async function getUserEggs(userId) {
  const result = await pool.query(
    "SELECT eggs FROM users WHERE discord_id = $1",
    [userId]
  );

  return Number(result.rows[0]?.eggs || 0);
}

async function removeBet(userId, username, bet) {
  const result = await pool.query(
    `
    UPDATE users
    SET eggs = eggs - $1, username = $2
    WHERE discord_id = $3 AND eggs >= $1
    RETURNING eggs
    `,
    [bet, username, userId]
  );

  return result.rows[0] ? Number(result.rows[0].eggs) : null;
}

async function addWinnings(userId, username, win) {
  const result = await pool.query(
    `
    UPDATE users
    SET eggs = eggs + $1, username = $2
    WHERE discord_id = $3
    RETURNING eggs
    `,
    [win, username, userId]
  );

  return Number(result.rows[0]?.eggs || 0);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("slots")
    .setDescription("Play the EggHub slot machine")
    .addIntegerOption(option =>
      option
        .setName("bet")
        .setDescription("Amount of Eggs to bet")
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const originalBet = interaction.options.getInteger("bet");

    if (originalBet < MIN_BET || originalBet > MAX_BET) {
      return interaction.reply({
        content: `Bet must be between ${MIN_BET} and ${MAX_BET} Eggs.`,
        ephemeral: true,
      });
    }

    if (activeSlots.has(userId)) {
      return interaction.reply({
        content: "You already have a slot machine running.",
        ephemeral: true,
      });
    }

    activeSlots.add(userId);

    let currentBet = originalBet;
    let message = null;
    let collector = null;
    let spinning = false;

    function cleanup() {
      activeSlots.delete(userId);
    }

    async function runSpin() {
      if (spinning) return;
      spinning = true;

      const currentEggs = await getUserEggs(userId);

      if (currentEggs < currentBet) {
        spinning = false;
        cleanup();

        if (message) {
          await message.edit({
            content: `❌ You only have ${currentEggs} Eggs. You need ${currentBet} Eggs to spin again.`,
            embeds: [],
            components: [],
          }).catch(() => null);
        }

        return;
      }

      const balanceAfterBet = await removeBet(userId, username, currentBet);

      if (balanceAfterBet === null) {
        spinning = false;
        cleanup();

        if (message) {
          await message.edit({
            content: "❌ You do not have enough Eggs for that bet.",
            embeds: [],
            components: [],
          }).catch(() => null);
        }

        return;
      }

      let grid = spinGrid();

      if (!message) {
        await interaction.reply({
          embeds: [
            buildEmbed({
              grid,
              bet: currentBet,
              win: 0,
              status: "spinning",
            }),
          ],
          components: makeButtons(userId, "spinning"),
        });

        message = await interaction.fetchReply();

        collector = message.createMessageComponentCollector({
          time: 15 * 60 * 1000,
        });

        collector.on("collect", async buttonInteraction => {
          try {
            if (buttonInteraction.user.id !== userId) {
              return buttonInteraction.reply({
                content: "This is not your slot machine.",
                ephemeral: true,
              });
            }

            await buttonInteraction.deferUpdate();

            if (buttonInteraction.customId === `slots_done_${userId}`) {
              if (collector) collector.stop("done");
              cleanup();

              await message.edit({
                components: [],
              }).catch(() => null);

              return;
            }

            if (buttonInteraction.customId === `slots_again_${userId}`) {
              await runSpin();
            }
          } catch (err) {
            console.error("Slots button error:", err);
            spinning = false;
            cleanup();
          }
        });

        collector.on("end", () => {
          cleanup();
        });
      } else {
        await message.edit({
          embeds: [
            buildEmbed({
              grid,
              bet: currentBet,
              win: 0,
              status: "spinning",
            }),
          ],
          components: makeButtons(userId, "spinning"),
        }).catch(() => null);
      }

      for (let i = 0; i < 4; i++) {
        await wait(SPIN_FRAME_MS);

        grid = spinGrid();

        await message.edit({
          embeds: [
            buildEmbed({
              grid,
              bet: currentBet,
              win: 0,
              status: "spinning",
            }),
          ],
          components: makeButtons(userId, "spinning"),
        }).catch(() => null);
      }

      const finalGrid = spinGrid();
      const result = calculateResult(finalGrid, currentBet);

      let finalBalance = Number(balanceAfterBet);

      if (result.win > 0) {
        finalBalance = await addWinnings(userId, username, result.win);
      }

      await message.edit({
        embeds: [
          buildEmbed({
            grid: finalGrid,
            bet: currentBet,
            win: result.win,
            status: result.type,
            label: result.label,
            balance: finalBalance,
          }),
        ],
        components: makeButtons(userId, "ended"),
      }).catch(() => null);

      spinning = false;
    }

    try {
      await runSpin();
    } catch (err) {
      console.error("Slots command error:", err);
      spinning = false;
      cleanup();

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