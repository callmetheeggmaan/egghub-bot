const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

const activeCrashGames = new Set();

const MIN_BET = 10;
const MAX_BET = 1000;
const GAME_TICK_MS = 1000;
const MAX_GAME_TIME_MS = 30000;

function randomCrashPoint() {
  const roll = Math.random();

  if (roll < 0.08) return Number((1.0 + Math.random() * 0.25).toFixed(2));
  if (roll < 0.45) return Number((1.25 + Math.random() * 0.75).toFixed(2));
  if (roll < 0.75) return Number((2.0 + Math.random() * 1.5).toFixed(2));
  if (roll < 0.92) return Number((3.5 + Math.random() * 3.5).toFixed(2));
  if (roll < 0.98) return Number((7.0 + Math.random() * 8.0).toFixed(2));

  return Number((15.0 + Math.random() * 20.0).toFixed(2));
}

function getMultiplier(elapsedMs) {
  const seconds = elapsedMs / 1000;
  return Number((1 + seconds * 0.18 + Math.pow(seconds, 1.35) * 0.035).toFixed(2));
}

function makeProgressBar(multiplier, crashPoint, status) {
  const blocks = 14;
  const ratio = Math.min(multiplier / Math.max(crashPoint, 2), 1);
  const filled = Math.max(1, Math.floor(ratio * blocks));
  const empty = blocks - filled;

  if (status === "crashed") {
    return `${"━".repeat(Math.max(0, filled - 1))}💥${"─".repeat(empty)}`;
  }

  if (status === "cashed") {
    return `${"━".repeat(Math.max(0, filled - 1))}💰${"─".repeat(empty)}`;
  }

  return `${"━".repeat(Math.max(0, filled - 1))}🚀${"─".repeat(empty)} 💰`;
}

function makeCashoutButton(userId, disabled = false, label = "CASH OUT") {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`crash_cashout_${userId}`)
      .setLabel(label)
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setEmoji(disabled ? "✅" : "💰")
      .setDisabled(disabled)
  );
}

function makeEmbed({
  user,
  bet,
  multiplier,
  potentialWin,
  status,
  crashPoint,
  winnings,
}) {
  let color = 0xf1c40f;
  let title = "🚀 EGG CRASH";
  let description = "Cash out before it crashes.";

  if (status === "cashed") {
    color = 0x2ecc71;
    title = "✅ CASHED OUT";
    description = `${user} escaped at **${multiplier.toFixed(2)}x**.`;
  }

  if (status === "crashed") {
    color = 0xe74c3c;
    title = "💥 CRASHED";
    description = `${user} crashed at **${crashPoint.toFixed(2)}x**.`;
  }

  const fields = [
    {
      name: "🥚 Bet",
      value: `${bet} Eggs`,
      inline: true,
    },
    {
      name: "📈 Multiplier",
      value: `${multiplier.toFixed(2)}x`,
      inline: true,
    },
    {
      name: "💰 Potential Win",
      value: `${potentialWin} Eggs`,
      inline: true,
    },
    {
      name: "🎮 Game",
      value: makeProgressBar(multiplier, crashPoint, status),
      inline: false,
    },
  ];

  if (status === "cashed") {
    fields.push({
      name: "🏆 Result",
      value: `Won **${winnings} Eggs**`,
      inline: false,
    });
  }

  if (status === "crashed") {
    fields.push({
      name: "❌ Result",
      value: `Lost **${bet} Eggs**`,
      inline: false,
    });
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setFooter({
      text:
        status === "playing"
          ? "Press CASH OUT before it crashes."
          : "EggHub Crash",
    });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("crash")
    .setDescription("Risk your Eggs in the Crash game")
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

    if (activeCrashGames.has(userId)) {
      return interaction.reply({
        content: "You already have a Crash game running.",
        ephemeral: true,
      });
    }

    if (bet < MIN_BET) {
      return interaction.reply({
        content: `Minimum bet is ${MIN_BET} Eggs.`,
        ephemeral: true,
      });
    }

    if (bet > MAX_BET) {
      return interaction.reply({
        content: `Maximum bet is ${MAX_BET} Eggs.`,
        ephemeral: true,
      });
    }

    activeCrashGames.add(userId);

    let gameInterval = null;
    let gameTimeout = null;
    let gameOver = false;
    let cashedOut = false;
    let crashed = false;
    let multiplier = 1.0;
    let latestMultiplier = 1.0;
    let message = null;

    try {
      const userResult = await pool.query(
        "SELECT eggs FROM users WHERE discord_id = $1",
        [userId]
      );

      if (userResult.rows.length === 0) {
        activeCrashGames.delete(userId);

        return interaction.reply({
          content: "You have no Eggs yet.",
          ephemeral: true,
        });
      }

      const currentEggs = Number(userResult.rows[0].eggs);

      if (currentEggs < bet) {
        activeCrashGames.delete(userId);

        return interaction.reply({
          content: `You only have ${currentEggs} Eggs.`,
          ephemeral: true,
        });
      }

      const removeBetResult = await pool.query(
        `
        UPDATE users
        SET eggs = eggs - $1, username = $2
        WHERE discord_id = $3 AND eggs >= $1
        RETURNING eggs
        `,
        [bet, username, userId]
      );

      if (removeBetResult.rows.length === 0) {
        activeCrashGames.delete(userId);

        return interaction.reply({
          content: "You do not have enough Eggs for that bet.",
          ephemeral: true,
        });
      }

      const crashPoint = randomCrashPoint();
      const startedAt = Date.now();

      await interaction.reply({
        embeds: [
          makeEmbed({
            user: interaction.user,
            bet,
            multiplier,
            potentialWin: bet,
            status: "playing",
            crashPoint,
          }),
        ],
        components: [makeCashoutButton(userId)],
      });

      message = await interaction.fetchReply();

      const collector = message.createMessageComponentCollector({
        time: MAX_GAME_TIME_MS + 5000,
      });

      collector.on("collect", async buttonInteraction => {
        if (!buttonInteraction.customId.startsWith("crash_cashout_")) return;

        if (buttonInteraction.user.id !== userId) {
          return buttonInteraction.reply({
            content: "This is not your Crash game.",
            ephemeral: true,
          });
        }

        if (gameOver || cashedOut || crashed) {
          return buttonInteraction.reply({
            content: "This Crash game is already over.",
            ephemeral: true,
          });
        }

        const elapsed = Date.now() - startedAt;
        const cashoutMultiplier = getMultiplier(elapsed);

        if (cashoutMultiplier >= crashPoint) {
          crashed = true;
          gameOver = true;

          clearInterval(gameInterval);
          clearTimeout(gameTimeout);

          await buttonInteraction.update({
            embeds: [
              makeEmbed({
                user: interaction.user,
                bet,
                multiplier: crashPoint,
                potentialWin: 0,
                status: "crashed",
                crashPoint,
              }),
            ],
            components: [makeCashoutButton(userId, true, "CRASHED")],
          }).catch(() => null);

          collector.stop("crashed");
          return;
        }

        cashedOut = true;
        gameOver = true;

        clearInterval(gameInterval);
        clearTimeout(gameTimeout);

        const winnings = Math.floor(bet * cashoutMultiplier);

        await pool.query(
          `
          UPDATE users
          SET eggs = eggs + $1, username = $2
          WHERE discord_id = $3
          `,
          [winnings, username, userId]
        );

        await buttonInteraction.update({
          embeds: [
            makeEmbed({
              user: interaction.user,
              bet,
              multiplier: cashoutMultiplier,
              potentialWin: winnings,
              status: "cashed",
              crashPoint,
              winnings,
            }),
          ],
          components: [makeCashoutButton(userId, true, "CASHED OUT")],
        }).catch(() => null);

        collector.stop("cashed");
      });

      gameInterval = setInterval(async () => {
        if (gameOver || cashedOut || crashed) {
          clearInterval(gameInterval);
          return;
        }

        const elapsed = Date.now() - startedAt;
        multiplier = getMultiplier(elapsed);
        latestMultiplier = multiplier;

        if (multiplier >= crashPoint) {
          crashed = true;
          gameOver = true;

          clearInterval(gameInterval);
          clearTimeout(gameTimeout);

          await message.edit({
            embeds: [
              makeEmbed({
                user: interaction.user,
                bet,
                multiplier: crashPoint,
                potentialWin: 0,
                status: "crashed",
                crashPoint,
              }),
            ],
            components: [makeCashoutButton(userId, true, "CRASHED")],
          }).catch(() => null);

          collector.stop("crashed");
          return;
        }

        const potentialWin = Math.floor(bet * multiplier);

        await message.edit({
          embeds: [
            makeEmbed({
              user: interaction.user,
              bet,
              multiplier,
              potentialWin,
              status: "playing",
              crashPoint,
            }),
          ],
          components: [makeCashoutButton(userId)],
        }).catch(() => null);
      }, GAME_TICK_MS);

      gameTimeout = setTimeout(async () => {
        if (gameOver || cashedOut || crashed) return;

        crashed = true;
        gameOver = true;

        clearInterval(gameInterval);

        await message.edit({
          embeds: [
            makeEmbed({
              user: interaction.user,
              bet,
              multiplier: latestMultiplier,
              potentialWin: 0,
              status: "crashed",
              crashPoint: latestMultiplier,
            }),
          ],
          components: [makeCashoutButton(userId, true, "CRASHED")],
        }).catch(() => null);

        collector.stop("timeout");
      }, MAX_GAME_TIME_MS);

      collector.on("end", () => {
        clearInterval(gameInterval);
        clearTimeout(gameTimeout);
        activeCrashGames.delete(userId);
      });
    } catch (error) {
      console.error("Crash command error:", error);

      clearInterval(gameInterval);
      clearTimeout(gameTimeout);
      activeCrashGames.delete(userId);

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({
          content: "Crash game failed.",
          ephemeral: true,
        }).catch(() => null);
      }

      return interaction.reply({
        content: "Crash game failed.",
        ephemeral: true,
      }).catch(() => null);
    }
  },
};