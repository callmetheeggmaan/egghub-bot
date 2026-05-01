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

function spinLine() {
  return [randomSymbol(), randomSymbol(), randomSymbol()];
}

function buildMachine(line) {
  return (
    `╔══════════════╗\n` +
    `║   🎰 EGGHUB   ║\n` +
    `╠══════════════╣\n` +
    `║  ${line[0]}  |  ${line[1]}  |  ${line[2]}  ║\n` +
    `╚══════════════╝`
  );
}

function calculateResult(line, bet) {
  const [a, b, c] = line;

  if (a === b && b === c) {
    const multiplier = PAYOUTS[a] || 2;

    if (a === "💎") {
      return {
        win: bet * multiplier,
        type: "jackpot",
        label: `💎 DIAMOND JACKPOT x${multiplier}`,
      };
    }

    if (a === "🥚") {
      return {
        win: bet * multiplier,
        type: "eggpot",
        label: `🥚 EGG JACKPOT x${multiplier}`,
      };
    }

    return {
      win: bet * multiplier,
      type: "bigwin",
      label: `${a} THREE OF A KIND x${multiplier}`,
    };
  }

  if (a === b || b === c || a === c) {
    return {
      win: Math.floor(bet * 1.5),
      type: "smallwin",
      label: "✨ TWO MATCHED x1.5",
    };
  }

  return {
    win: 0,
    type: "loss",
    label: "❌ NO MATCH",
  };
}

function makeButtons(userId, state) {
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

function buildEmbed({
  line,
  bet,
  win,
  status,
  label,
  balance,
}) {
  let color = 0xf1c40f;
  let title = "🎰 EGGHUB SLOTS";
  let resultText = label || "Pulling the lever...";

  if (status === "spinning") {
    color = 0x3498db;
    title = "🎰 SPINNING";
    resultText = "The reels are spinning...";
  }

  if (status === "loss") {
    color = 0xe74c3c;
    title = "💀 NO WIN";
  }

  if (status === "smallwin") {
    color = 0x2ecc71;
    title = "✅ SMALL WIN";
  }

  if (status === "bigwin") {
    color = 0x9b59b6;
    title = "🔥 BIG WIN";
  }

  if (status === "eggpot") {
    color = 0xf1c40f;
    title = "🥚 EGG JACKPOT";
  }

  if (status === "jackpot") {
    color = 0x00ffff;
    title = "💎 JACKPOT";
  }

  let description =
    "```txt\n" +
    buildMachine(line) +
    "\n```\n" +
    `**${resultText}**\n\n` +
    `🥚 **Bet:** ${bet} Eggs\n` +
    `💰 **Win:** ${win} Eggs`;

  if (typeof balance === "number") {
    description += `\n🏦 **Balance:** ${balance} Eggs`;
  }

  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Match 2 or 3 symbols to win." });
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
    const bet = interaction.options.getInteger("bet");

    if (bet < MIN_BET || bet > MAX_BET) {
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

    let message = null;
    let collector = null;
    let spinning = false;

    function cleanup() {
      activeSlots.delete(userId);
    }

    async function runSpin() {
      if (spinning) return;
      spinning = true;

      try {
        const currentEggs = await getUserEggs(userId);

        if (currentEggs < bet) {
          spinning = false;
          cleanup();

          if (message) {
            await message.edit({
              content: `❌ You only have ${currentEggs} Eggs. You need ${bet} Eggs.`,
              embeds: [],
              components: [],
            }).catch(() => null);
          }

          return;
        }

        const balanceAfterBet = await removeBet(userId, username, bet);

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

        let line = spinLine();

        if (!message) {
          await interaction.reply({
            embeds: [
              buildEmbed({
                line,
                bet,
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
                line,
                bet,
                win: 0,
                status: "spinning",
              }),
            ],
            components: makeButtons(userId, "spinning"),
          }).catch(() => null);
        }

        await wait(250);
        line = spinLine();

        await message.edit({
          embeds: [
            buildEmbed({
              line,
              bet,
              win: 0,
              status: "spinning",
            }),
          ],
          components: makeButtons(userId, "spinning"),
        }).catch(() => null);

        await wait(250);
        line = spinLine();

        await message.edit({
          embeds: [
            buildEmbed({
              line,
              bet,
              win: 0,
              status: "spinning",
            }),
          ],
          components: makeButtons(userId, "spinning"),
        }).catch(() => null);

        await wait(350);

        const finalLine = spinLine();
        const result = calculateResult(finalLine, bet);

        let finalBalance = Number(balanceAfterBet);

        if (result.win > 0) {
          finalBalance = await addWinnings(userId, username, result.win);
        }

        await message.edit({
          embeds: [
            buildEmbed({
              line: finalLine,
              bet,
              win: result.win,
              status: result.type,
              label: result.label,
              balance: finalBalance,
            }),
          ],
          components: makeButtons(userId, "ended"),
        }).catch(() => null);

        spinning = false;
      } catch (err) {
        console.error("Slots spin error:", err);
        spinning = false;
        cleanup();

        if (message) {
          await message.edit({
            content: "❌ Slots crashed during the spin. Try again.",
            embeds: [],
            components: [],
          }).catch(() => null);
        }
      }
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