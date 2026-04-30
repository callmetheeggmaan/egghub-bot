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
  const blocks = 16;
  const ratio = Math.min(multiplier / Math.max(crashPoint, 2), 1);

  const filled = Math.max(1, Math.floor(ratio * blocks));
  const empty = blocks - filled;

  let bar = "▰".repeat(filled) + "▱".repeat(empty);

  if (status === "crashed") return `💥 ${bar}`;
  if (status === "cashed") return `💰 ${bar}`;

  return `🚀 ${bar}`;
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

  let mainDisplay = `**${multiplier.toFixed(2)}x**`;

  if (status === "playing") {
    if (multiplier >= 5) mainDisplay = `🔥 **${multiplier.toFixed(2)}x**`;
    if (multiplier >= 10) mainDisplay = `🚨 **${multiplier.toFixed(2)}x**`;
  }

  if (status === "cashed") {
    color = 0x2ecc71;
    title = "✅ CASHED OUT";
    mainDisplay = `💰 **${multiplier.toFixed(2)}x**`;
  }

  if (status === "crashed") {
    color = 0xe74c3c;
    title = "💥 CRASHED";
    mainDisplay = `💥 **${crashPoint.toFixed(2)}x**`;
  }

  let description =
    `\n${mainDisplay}\n\n` +
    `${makeProgressBar(multiplier, crashPoint, status)}\n`;

  let footer = "Press CASH OUT before it crashes.";

  if (status === "cashed") {
    description += `\n🏆 You won **${winnings} Eggs**`;
    footer = "Clean exit.";
  }

  if (status === "crashed") {
    description += `\n❌ You lost **${bet} Eggs**`;
    footer = "Too slow.";
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: "🥚 Bet", value: `${bet}`, inline: true },
      { name: "💰 Value", value: `${potentialWin}`, inline: true }
    )
    .setFooter({ text: footer });
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

    if (bet < MIN_BET || bet > MAX_BET) {
      return interaction.reply({
        content: `Bet must be between ${MIN_BET} and ${MAX_BET}.`,
        ephemeral: true,
      });
    }

    activeCrashGames.add(userId);

    let gameInterval = null;
    let gameOver = false;
    let multiplier = 1.0;

    try {
      const result = await pool.query(
        "SELECT eggs FROM users WHERE discord_id = $1",
        [userId]
      );

      const currentEggs = result.rows[0]?.eggs || 0;

      if (currentEggs < bet) {
        activeCrashGames.delete(userId);
        return interaction.reply({
          content: `You only have ${currentEggs} Eggs.`,
          ephemeral: true,
        });
      }

      await pool.query(
        "UPDATE users SET eggs = eggs - $1 WHERE discord_id = $2",
        [bet, userId]
      );

      const crashPoint = randomCrashPoint();
      const startTime = Date.now();

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

      const message = await interaction.fetchReply();

      const collector = message.createMessageComponentCollector({
        time: MAX_GAME_TIME_MS,
      });

      collector.on("collect", async i => {
        if (i.user.id !== userId || gameOver) return;

        const elapsed = Date.now() - startTime;
        const cashMultiplier = getMultiplier(elapsed);

        if (cashMultiplier >= crashPoint) {
          gameOver = true;
          await i.update({
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
          });
          return;
        }

        const winnings = Math.floor(bet * cashMultiplier);

        await pool.query(
          "UPDATE users SET eggs = eggs + $1 WHERE discord_id = $2",
          [winnings, userId]
        );

        gameOver = true;

        await i.update({
          embeds: [
            makeEmbed({
              user: interaction.user,
              bet,
              multiplier: cashMultiplier,
              potentialWin: winnings,
              status: "cashed",
              crashPoint,
              winnings,
            }),
          ],
          components: [makeCashoutButton(userId, true, "CASHED OUT")],
        });
      });

      gameInterval = setInterval(async () => {
        if (gameOver) return clearInterval(gameInterval);

        const elapsed = Date.now() - startTime;
        multiplier = getMultiplier(elapsed);

        if (multiplier >= crashPoint) {
          gameOver = true;
          clearInterval(gameInterval);

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
          });

          return;
        }

        await message.edit({
          embeds: [
            makeEmbed({
              user: interaction.user,
              bet,
              multiplier,
              potentialWin: Math.floor(bet * multiplier),
              status: "playing",
              crashPoint,
            }),
          ],
          components: [makeCashoutButton(userId)],
        });
      }, GAME_TICK_MS);

    } catch (err) {
      console.error(err);
      activeCrashGames.delete(userId);
    }
  },
};