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
const GRID_SIZE = 16;
const FOX_COUNT = 4;

const activeChickenGames = new Set();

function shuffle(array) {
  return array.sort(() => Math.random() - 0.5);
}

function createBoard() {
  const board = Array(GRID_SIZE).fill("egg");

  for (let i = 0; i < FOX_COUNT; i++) {
    board[i] = "fox";
  }

  return shuffle(board);
}

function getMultiplier(safePicks) {
  const multipliers = [
    1.0, 1.25, 1.6, 2.1, 2.8, 3.8, 5.0, 6.5, 8.5,
    11.0, 14.0, 18.0, 24.0,
  ];

  return multipliers[Math.min(safePicks, multipliers.length - 1)];
}

function renderGrid(board, revealed, gameOver = false) {
  let text = "";

  for (let i = 0; i < GRID_SIZE; i++) {
    if (revealed.has(i) || gameOver) {
      text += board[i] === "fox" ? "🦊" : "🥚";
    } else {
      text += "⬛";
    }

    if ((i + 1) % 4 === 0) text += "\n";
    else text += " ";
  }

  return text;
}

function makeEmbed({
  board,
  revealed,
  bet,
  status,
  safePicks,
  balance = null,
}) {
  const multiplier = getMultiplier(safePicks);
  const currentValue = Math.floor(bet * multiplier);

  let color = 0xf1c40f;
  let title = "🐔 CHICKEN RUN";
  let message = "Pick tiles, find eggs, avoid the foxes.";

  if (status === "playing") {
    if (safePicks >= 3) message = "🔥 Getting risky. Cash out or keep going?";
    if (safePicks >= 6) message = "🚨 High stakes now.";
  }

  if (status === "cashed") {
    color = 0x2ecc71;
    title = "✅ CHICKEN ESCAPED";
    message = `You cashed out for **${currentValue} Eggs**.`;
  }

  if (status === "lost") {
    color = 0xe74c3c;
    title = "🦊 CAUGHT BY A FOX";
    message = `You lost **${bet} Eggs**.`;
  }

  let description =
    `${renderGrid(board, revealed, status !== "playing")}\n` +
    `🥚 **Bet:** ${bet} Eggs\n` +
    `📈 **Multiplier:** ${multiplier.toFixed(2)}x\n` +
    `💰 **Cashout Value:** ${status === "lost" ? 0 : currentValue} Eggs\n\n` +
    `${message}`;

  if (balance !== null) {
    description += `\n\n🏦 **Balance:** ${balance} Eggs`;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Chicken Run: eggs are safe, foxes end the game." });
}

function makeButtons(userId, board, revealed, ended = false) {
  const rows = [];

  for (let row = 0; row < 4; row++) {
    const actionRow = new ActionRowBuilder();

    for (let col = 0; col < 4; col++) {
      const index = row * 4 + col;
      const isRevealed = revealed.has(index);

      let label = "?";
      let style = ButtonStyle.Secondary;

      if (isRevealed || ended) {
        if (board[index] === "fox") {
          label = "🦊";
          style = ButtonStyle.Danger;
        } else {
          label = "🥚";
          style = ButtonStyle.Success;
        }
      }

      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`chicken_tile_${userId}_${index}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(ended || isRevealed)
      );
    }

    rows.push(actionRow);
  }

  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chicken_cashout_${userId}`)
      .setLabel("CASH OUT")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success)
      .setDisabled(ended || revealed.size === 0),
    new ButtonBuilder()
      .setCustomId(`chicken_again_${userId}`)
      .setLabel("PLAY AGAIN")
      .setEmoji("🔁")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!ended),
    new ButtonBuilder()
      .setCustomId(`chicken_done_${userId}`)
      .setLabel("DONE")
      .setEmoji("🛑")
      .setStyle(ButtonStyle.Secondary)
  );

  rows.push(controlRow);

  return rows;
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

async function addWinnings(userId, username, amount) {
  const result = await pool.query(
    `
    UPDATE users
    SET eggs = eggs + $1, username = $2
    WHERE discord_id = $3
    RETURNING eggs
    `,
    [amount, username, userId]
  );

  return Number(result.rows[0]?.eggs || 0);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("chicken")
    .setDescription("Play Chicken Run and avoid the foxes")
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

    if (bet < MIN_BET || bet > MAX_BET) {
      return interaction.reply({
        content: `Bet must be between ${MIN_BET} and ${MAX_BET} Eggs.`,
        ephemeral: true,
      });
    }

    if (activeChickenGames.has(userId)) {
      return interaction.reply({
        content: "You already have a Chicken Run game open.",
        ephemeral: true,
      });
    }

    activeChickenGames.add(userId);

    let board = createBoard();
    let revealed = new Set();
    let safePicks = 0;
    let ended = false;
    let message = null;
    let collector = null;

    function cleanup() {
      activeChickenGames.delete(userId);
    }

    async function startNewRound() {
      const currentEggs = await getUserEggs(userId);

      if (currentEggs < bet) {
        ended = true;
        cleanup();

        await message.edit({
          content: `❌ You only have ${currentEggs} Eggs. You need ${bet} Eggs to play.`,
          embeds: [],
          components: [],
        }).catch(() => null);

        return;
      }

      const balanceAfterBet = await removeBet(userId, username, bet);

      if (balanceAfterBet === null) {
        ended = true;
        cleanup();

        await message.edit({
          content: "❌ You do not have enough Eggs for that bet.",
          embeds: [],
          components: [],
        }).catch(() => null);

        return;
      }

      board = createBoard();
      revealed = new Set();
      safePicks = 0;
      ended = false;

      await message.edit({
        content: null,
        embeds: [
          makeEmbed({
            board,
            revealed,
            bet,
            status: "playing",
            safePicks,
            balance: balanceAfterBet,
          }),
        ],
        components: makeButtons(userId, board, revealed, false),
      }).catch(() => null);
    }

    try {
      const currentEggs = await getUserEggs(userId);

      if (currentEggs < bet) {
        cleanup();

        return interaction.reply({
          content: `You only have ${currentEggs} Eggs.`,
          ephemeral: true,
        });
      }

      const balanceAfterBet = await removeBet(userId, username, bet);

      if (balanceAfterBet === null) {
        cleanup();

        return interaction.reply({
          content: "You do not have enough Eggs for that bet.",
          ephemeral: true,
        });
      }

      await interaction.reply({
        embeds: [
          makeEmbed({
            board,
            revealed,
            bet,
            status: "playing",
            safePicks,
            balance: balanceAfterBet,
          }),
        ],
        components: makeButtons(userId, board, revealed, false),
      });

      message = await interaction.fetchReply();

      collector = message.createMessageComponentCollector({
        time: 15 * 60 * 1000,
      });

      collector.on("collect", async buttonInteraction => {
        try {
          if (buttonInteraction.user.id !== userId) {
            return buttonInteraction.reply({
              content: "This is not your Chicken Run game.",
              ephemeral: true,
            });
          }

          await buttonInteraction.deferUpdate();

          const customId = buttonInteraction.customId;

          if (customId === `chicken_done_${userId}`) {
            if (collector) collector.stop("done");
            cleanup();

            await message.edit({
              components: [],
            }).catch(() => null);

            return;
          }

          if (customId === `chicken_again_${userId}`) {
            if (!ended) return;
            await startNewRound();
            return;
          }

          if (ended) return;

          if (customId === `chicken_cashout_${userId}`) {
            if (safePicks <= 0) return;

            ended = true;

            const multiplier = getMultiplier(safePicks);
            const winnings = Math.floor(bet * multiplier);
            const balance = await addWinnings(userId, username, winnings);

            await message.edit({
              embeds: [
                makeEmbed({
                  board,
                  revealed,
                  bet,
                  status: "cashed",
                  safePicks,
                  balance,
                }),
              ],
              components: makeButtons(userId, board, revealed, true),
            }).catch(() => null);

            return;
          }

          if (customId.startsWith(`chicken_tile_${userId}_`)) {
            const index = Number(customId.split("_").pop());

            if (revealed.has(index)) return;

            revealed.add(index);

            if (board[index] === "fox") {
              ended = true;

              const balance = await getUserEggs(userId);

              await message.edit({
                embeds: [
                  makeEmbed({
                    board,
                    revealed,
                    bet,
                    status: "lost",
                    safePicks,
                    balance,
                  }),
                ],
                components: makeButtons(userId, board, revealed, true),
              }).catch(() => null);

              return;
            }

            safePicks += 1;

            const balance = await getUserEggs(userId);

            await message.edit({
              embeds: [
                makeEmbed({
                  board,
                  revealed,
                  bet,
                  status: "playing",
                  safePicks,
                  balance,
                }),
              ],
              components: makeButtons(userId, board, revealed, false),
            }).catch(() => null);
          }
        } catch (err) {
          console.error("Chicken button error:", err);
          cleanup();
        }
      });

      collector.on("end", () => {
        cleanup();
      });
    } catch (err) {
      console.error("Chicken command error:", err);
      cleanup();

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({
          content: "Chicken Run failed.",
          ephemeral: true,
        }).catch(() => null);
      }

      return interaction.reply({
        content: "Chicken Run failed.",
        ephemeral: true,
      }).catch(() => null);
    }
  },
};