const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");
const { BRAND, formatCurrency, originLine } = require("../config/brand");
const { addToJackpot, rollJackpotWin, payJackpot } = require("../utils/jackpot");

const activeCrashGames = new Set();

const MIN_BET = 10;
const MAX_BET = 5000;
const GAME_TICK_MS = 700;
const START_DELAY_MS = 1500;
const MAX_GAME_TIME_MS = 25000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomCrashPoint() {
  const roll = Math.random();

  if (roll < 0.25) return Number((1.10 + Math.random() * 0.45).toFixed(2));
  if (roll < 0.55) return Number((1.55 + Math.random() * 0.95).toFixed(2));
  if (roll < 0.78) return Number((2.50 + Math.random() * 2.00).toFixed(2));
  if (roll < 0.92) return Number((4.50 + Math.random() * 4.50).toFixed(2));
  if (roll < 0.98) return Number((9.00 + Math.random() * 8.00).toFixed(2));

  return Number((17.00 + Math.random() * 18.00).toFixed(2));
}

function getMultiplier(elapsedMs) {
  const seconds = elapsedMs / 1000;
  return Number((1 + seconds * 0.22 + Math.pow(seconds, 1.35) * 0.045).toFixed(2));
}

function makeBar(multiplier, crashPoint, status) {
  const blocks = 18;
  const ratio = Math.min(multiplier / Math.max(crashPoint, 2), 1);
  const filled = Math.max(1, Math.floor(ratio * blocks));
  const empty = blocks - filled;

  if (status === "crashed") return "■".repeat(filled) + "□".repeat(empty);
  if (status === "cashed") return "◆".repeat(filled) + "◇".repeat(empty);
  if (multiplier >= 5) return "◆".repeat(filled) + "◇".repeat(empty);
  if (multiplier >= 2.5) return "◆".repeat(filled) + "◇".repeat(empty);

  return "◆".repeat(filled) + "◇".repeat(empty);
}

function makeButtons(userId, state = "playing") {
  if (state === "playing") {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`crash_cashout_${userId}`)
          .setLabel("Cash Out")
          .setStyle(ButtonStyle.Success)
      ),
    ];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`crash_again_${userId}`)
        .setLabel("Play Again")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`crash_done_${userId}`)
        .setLabel("Done")
        .setStyle(ButtonStyle.Secondary)
    ),
  ];
}

function makeEmbed({
  bet,
  multiplier,
  potentialWin,
  status,
  winnings = 0,
  balance = null,
  countdown = null,
  jackpotWin = 0,
}) {
  let color = BRAND.colour;
  let title = "Origin Crash";
  let headline = `**${multiplier.toFixed(2)}x**`;
  let resultText = "Cash out before the market collapses.";

  if (status === "starting") {
    color = 0x3b82f6;
    title = "Origin Crash Starting";
    headline = `Starting in **${countdown}**`;
    resultText = "Prepare your position.";
  }

  if (status === "playing") {
    if (multiplier >= 2.5) headline = `**${multiplier.toFixed(2)}x**`;
    if (multiplier >= 5) headline = `**${multiplier.toFixed(2)}x**`;
    if (multiplier >= 10) headline = `**${multiplier.toFixed(2)}x**`;
  }

  if (status === "cashed") {
    color = 0x22c55e;
    title = jackpotWin > 0 ? "Origin Jackpot Cashout" : "Cashed Out";
    headline = `**${multiplier.toFixed(2)}x**`;
    resultText = jackpotWin > 0
      ? `You won **${formatCurrency(winnings)}**, including a jackpot of **${formatCurrency(jackpotWin)}**.`
      : `You won **${formatCurrency(winnings)}**.`;
  }

  if (status === "crashed") {
    color = 0xef4444;
    title = "Crashed";
    headline = `**${multiplier.toFixed(2)}x**`;
    resultText = `You lost **${formatCurrency(bet)}**.`;
  }

  let description =
    `${originLine()}\n` +
    `${headline}\n\n` +
    `${makeBar(multiplier, multiplier + 1, status)}\n\n` +
    `**Bet:** ${formatCurrency(bet)}\n` +
    `**Cashout Value:** ${formatCurrency(potentialWin)}\n\n` +
    `${resultText}`;

  if (balance !== null) {
    description += `\n\n**Balance:** ${formatCurrency(balance)}`;
  }

  description += `\n${originLine()}`;

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `${BRAND.fullName} • Crash` });
}

function buildJackpotAnnouncement(interaction, jackpotWin) {
  return new EmbedBuilder()
    .setTitle("ORIGIN JACKPOT HIT")
    .setDescription(
      [
        originLine(),
        `${interaction.user} claimed the Origin Jackpot through Crash.`,
        "",
        `**${formatCurrency(jackpotWin)}**`,
        originLine()
      ].join("\n")
    )
    .setColor(BRAND.colour)
    .setFooter({ text: `${BRAND.fullName} • Global Jackpot` });
}

async function getUserBalance(userId) {
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
    SET eggs = eggs - $1,
        username = $2
    WHERE discord_id = $3
    AND eggs >= $1
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
    SET eggs = eggs + $1,
        username = $2
    WHERE discord_id = $3
    RETURNING eggs
    `,
    [amount, username, userId]
  );

  return Number(result.rows[0]?.eggs || 0);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("crash")
    .setDescription("Play Origin Crash.")
    .addIntegerOption((option) =>
      option
        .setName("bet")
        .setDescription("Amount of Origin Coins to bet")
        .setRequired(true)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const originalBet = interaction.options.getInteger("bet");

    if (originalBet < MIN_BET || originalBet > MAX_BET) {
      return interaction.reply({
        content: `Bet must be between ${formatCurrency(MIN_BET)} and ${formatCurrency(MAX_BET)}.`,
        ephemeral: true,
      });
    }

    if (activeCrashGames.has(userId)) {
      return interaction.reply({
        content: "You already have an Origin Crash game running.",
        ephemeral: true,
      });
    }

    activeCrashGames.add(userId);

    let currentBet = originalBet;
    let message = null;
    let collector = null;
    let gameInterval = null;
    let gameOver = false;
    let gameStarted = false;
    let startTime = null;
    let crashPoint = null;

    function clearGameTimers() {
      if (gameInterval) clearInterval(gameInterval);
      gameInterval = null;
    }

    function endActiveGame() {
      clearGameTimers();
      activeCrashGames.delete(userId);
    }

    async function startRound() {
      clearGameTimers();

      gameOver = false;
      gameStarted = false;
      startTime = null;
      crashPoint = randomCrashPoint();

      const currentBalance = await getUserBalance(userId);

      if (currentBalance < currentBet) {
        endActiveGame();

        if (message) {
          await message.edit({
            content: `You only have ${formatCurrency(currentBalance)}. You need ${formatCurrency(currentBet)} to play again.`,
            embeds: [],
            components: [],
          }).catch(() => null);
        }

        return;
      }

      const balanceAfterBet = await removeBet(userId, username, currentBet);

      if (balanceAfterBet === null) {
        endActiveGame();

        if (message) {
          await message.edit({
            content: "You do not have enough Origin Coins for that bet.",
            embeds: [],
            components: [],
          }).catch(() => null);
        }

        return;
      }

      await addToJackpot(
        Math.floor(currentBet * 0.05),
        userId,
        username,
        "crash_bet"
      );

      const startingEmbed = makeEmbed({
        bet: currentBet,
        multiplier: 1.0,
        potentialWin: currentBet,
        status: "starting",
        countdown: 2,
      });

      if (!message) {
        await interaction.reply({
          embeds: [startingEmbed],
          components: [],
        });

        message = await interaction.fetchReply();

        collector = message.createMessageComponentCollector({
          time: 15 * 60 * 1000,
        });

        collector.on("collect", async (buttonInteraction) => {
          try {
            if (buttonInteraction.user.id !== userId) {
              return buttonInteraction.reply({
                content: "This is not your Origin Crash game.",
                ephemeral: true,
              });
            }

            await buttonInteraction.deferUpdate();

            if (buttonInteraction.customId === `crash_done_${userId}`) {
              if (collector) collector.stop("done");
              endActiveGame();

              await message.edit({
                components: [],
              }).catch(() => null);

              return;
            }

            if (buttonInteraction.customId === `crash_again_${userId}`) {
              if (!gameOver) return;
              await startRound();
              return;
            }

            if (buttonInteraction.customId !== `crash_cashout_${userId}`) return;

            if (!gameStarted || gameOver) return;

            const elapsed = Date.now() - startTime;
            const cashMultiplier = getMultiplier(elapsed);

            if (cashMultiplier >= crashPoint) {
              gameOver = true;
              gameStarted = false;
              clearGameTimers();

              const balance = await getUserBalance(userId);

              await message.edit({
                embeds: [
                  makeEmbed({
                    bet: currentBet,
                    multiplier: crashPoint,
                    potentialWin: 0,
                    status: "crashed",
                    balance,
                  }),
                ],
                components: makeButtons(userId, "ended"),
              }).catch(() => null);

              return;
            }

            gameOver = true;
            gameStarted = false;
            clearGameTimers();

            let jackpotWin = 0;
            let winnings = Math.floor(currentBet * cashMultiplier);

            if (await rollJackpotWin(0.25)) {
              jackpotWin = await payJackpot(userId, username);

              if (jackpotWin > 0) {
                winnings += jackpotWin;
              }
            }

            const balance = await addWinnings(userId, username, winnings);

            await message.edit({
              embeds: [
                makeEmbed({
                  bet: currentBet,
                  multiplier: cashMultiplier,
                  potentialWin: winnings,
                  status: "cashed",
                  winnings,
                  balance,
                  jackpotWin,
                }),
              ],
              components: makeButtons(userId, "ended"),
            }).catch(() => null);

            if (jackpotWin > 0) {
              await interaction.followUp({
                embeds: [buildJackpotAnnouncement(interaction, jackpotWin)]
              });
            }
          } catch (err) {
            console.error("Crash button error:", err);
            endActiveGame();
          }
        });

        collector.on("end", () => {
          endActiveGame();
        });
      } else {
        await message.edit({
          embeds: [startingEmbed],
          components: [],
        }).catch(() => null);
      }

      await wait(START_DELAY_MS);

      if (gameOver) return;

      gameStarted = true;
      startTime = Date.now();

      await message.edit({
        embeds: [
          makeEmbed({
            bet: currentBet,
            multiplier: 1.0,
            potentialWin: currentBet,
            status: "playing",
          }),
        ],
        components: makeButtons(userId, "playing"),
      }).catch(() => null);

      gameInterval = setInterval(async () => {
        try {
          if (gameOver || !gameStarted) {
            clearGameTimers();
            return;
          }

          const elapsed = Date.now() - startTime;
          const multiplier = getMultiplier(elapsed);

          if (elapsed >= MAX_GAME_TIME_MS || multiplier >= crashPoint) {
            gameOver = true;
            gameStarted = false;
            clearGameTimers();

            const balance = await getUserBalance(userId);

            await message.edit({
              embeds: [
                makeEmbed({
                  bet: currentBet,
                  multiplier: crashPoint,
                  potentialWin: 0,
                  status: "crashed",
                  balance,
                }),
              ],
              components: makeButtons(userId, "ended"),
            }).catch(() => null);

            return;
          }

          await message.edit({
            embeds: [
              makeEmbed({
                bet: currentBet,
                multiplier,
                potentialWin: Math.floor(currentBet * multiplier),
                status: "playing",
              }),
            ],
            components: makeButtons(userId, "playing"),
          }).catch(() => null);
        } catch (err) {
          console.error("Crash game loop error:", err);
          endActiveGame();
        }
      }, GAME_TICK_MS);
    }

    try {
      await startRound();
    } catch (err) {
      console.error("Crash command error:", err);
      endActiveGame();

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({
          content: "Origin Crash failed.",
          ephemeral: true,
        }).catch(() => null);
      }

      return interaction.reply({
        content: "Origin Crash failed.",
        ephemeral: true,
      }).catch(() => null);
    }
  },
};