const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");

const { Pool } = require("pg");
const { createGameRoom, deleteGameRoom } = require("../utils/gameRooms");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const MIN_BET = 10;
const MAX_BET = 20000;
const TICK_MS = 900;

function formatOC(amount) {
  return Number(amount || 0).toLocaleString("en-GB");
}

function makeCrashPoint() {
  const roll = Math.random();

  if (roll < 0.45) return +(1 + Math.random() * 0.8).toFixed(2);
  if (roll < 0.8) return +(1.8 + Math.random() * 1.7).toFixed(2);
  if (roll < 0.95) return +(3.5 + Math.random() * 4).toFixed(2);

  return +(7.5 + Math.random() * 8).toFixed(2);
}

async function ensureUser(discordId) {
  await pool.query(
    `INSERT INTO users (discord_id, eggs)
     VALUES ($1, 0)
     ON CONFLICT (discord_id) DO NOTHING`,
    [discordId]
  );
}

async function getBalance(discordId) {
  await ensureUser(discordId);

  const result = await pool.query(
    `SELECT eggs FROM users WHERE discord_id = $1`,
    [discordId]
  );

  return Number(result.rows[0]?.eggs || 0);
}

async function addCoins(discordId, amount) {
  await ensureUser(discordId);

  await pool.query(
    `UPDATE users
     SET eggs = eggs + $2
     WHERE discord_id = $1`,
    [discordId, amount]
  );
}

async function removeCoins(discordId, amount) {
  await ensureUser(discordId);

  await pool.query(
    `UPDATE users
     SET eggs = eggs - $2
     WHERE discord_id = $1`,
    [discordId, amount]
  );
}

async function ensureJackpotTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jackpot (
      id INTEGER PRIMARY KEY DEFAULT 1,
      amount BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await pool.query(`
    INSERT INTO jackpot (id, amount)
    VALUES (1, 0)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function addToJackpot(amount) {
  await ensureJackpotTable();

  await pool.query(
    `UPDATE jackpot
     SET amount = amount + $1,
         updated_at = NOW()
     WHERE id = 1`,
    [amount]
  );
}

async function getJackpot() {
  await ensureJackpotTable();

  const result = await pool.query(`SELECT amount FROM jackpot WHERE id = 1`);
  return Number(result.rows[0]?.amount || 0);
}

async function resetJackpot() {
  await ensureJackpotTable();

  await pool.query(
    `UPDATE jackpot
     SET amount = 0,
         updated_at = NOW()
     WHERE id = 1`
  );
}

async function tryWinJackpot(discordId) {
  const jackpotAmount = await getJackpot();

  if (jackpotAmount <= 0) {
    return { won: false, amount: 0 };
  }

  const roll = Math.random();

  if (roll <= 0.01) {
    await addCoins(discordId, jackpotAmount);
    await resetJackpot();

    return {
      won: true,
      amount: jackpotAmount,
    };
  }

  return {
    won: false,
    amount: jackpotAmount,
  };
}

function buildEmbed({ user, bet, multiplier, status, crashPoint, payout, jackpotAmount }) {
  let description = "";
  let color = 0x111111;

  if (status === "running") {
    color = 0xd4af37;
    description =
      `The Origin rocket is climbing.\n\n` +
      `Multiplier: **${multiplier.toFixed(2)}x**\n` +
      `Potential Cashout: **${formatOC(Math.floor(bet * multiplier))} OC**`;
  }

  if (status === "crashed") {
    color = 0x8b0000;
    description =
      `The game crashed at **${crashPoint.toFixed(2)}x**.\n\n` +
      `You lost **${formatOC(bet)} OC**.`;
  }

  if (status === "cashed") {
    color = 0xd4af37;
    description =
      `You cashed out at **${multiplier.toFixed(2)}x**.\n\n` +
      `You won **${formatOC(payout)} OC**.`;
  }

  return new EmbedBuilder()
    .setTitle("ORIGIN CRASH")
    .setColor(color)
    .setDescription(description)
    .addFields(
      {
        name: "Player",
        value: `${user}`,
        inline: true,
      },
      {
        name: "Bet",
        value: `${formatOC(bet)} OC`,
        inline: true,
      },
      {
        name: "Jackpot",
        value: `${formatOC(jackpotAmount)} OC`,
        inline: true,
      }
    )
    .setFooter({
      text: "Origin Casino • Private game room",
    })
    .setTimestamp();
}

function buildCashoutRow(customId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel(disabled ? "Game Ended" : "Cash Out")
      .setStyle(disabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(disabled)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("crash")
    .setDescription("Play Origin Crash in a private game room")
    .addIntegerOption((option) =>
      option
        .setName("bet")
        .setDescription("Amount of Origin Coins to bet")
        .setRequired(true)
        .setMinValue(MIN_BET)
        .setMaxValue(MAX_BET)
    ),

  async execute(interaction) {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const userId = interaction.user.id;
    const bet = interaction.options.getInteger("bet");

    if (bet < MIN_BET) {
      return interaction.editReply({
        content: `Minimum crash bet is **${MIN_BET} OC**.`,
      });
    }

    if (bet > MAX_BET) {
      return interaction.editReply({
        content: `Maximum crash bet is **${formatOC(MAX_BET)} OC**.`,
      });
    }

    const balance = await getBalance(userId);

    if (balance < bet) {
      return interaction.editReply({
        content: `You do not have enough Origin Coins. Your balance is **${formatOC(balance)} OC**.`,
      });
    }

    const roomResult = await createGameRoom(interaction, "crash");

    if (roomResult.alreadyExists) {
      return interaction.editReply({
        content: `You already have an active Origin game room: ${roomResult.channel}`,
      });
    }

    const gameChannel = roomResult.channel;

    await interaction.editReply({
      content: `Your private Origin Crash room is ready: ${gameChannel}`,
    });

    await removeCoins(userId, bet);

    const jackpotFeed = Math.max(1, Math.floor(bet * 0.05));
    await addToJackpot(jackpotFeed);

    const crashPoint = makeCrashPoint();

    let multiplier = 1.0;
    let gameEnded = false;
    let editLocked = false;
    let gameLoop = null;

    const customId = `origin_crash_cashout_${userId}_${Date.now()}`;

    const clearGameLoop = () => {
      if (gameLoop) {
        clearInterval(gameLoop);
        gameLoop = null;
      }
    };

    const safeEdit = async (message, payload) => {
      if (editLocked || gameEnded) return;

      editLocked = true;

      try {
        await message.edit(payload);
      } catch (error) {
        console.error("Crash safeEdit error:", error);
      } finally {
        editLocked = false;
      }
    };

    const jackpotAmount = await getJackpot();

    const startEmbed = buildEmbed({
      user: interaction.user,
      bet,
      multiplier,
      status: "running",
      crashPoint,
      payout: 0,
      jackpotAmount,
    });

    const gameMessage = await gameChannel.send({
      content: `${interaction.user}, your Origin Crash game has started.`,
      embeds: [startEmbed],
      components: [buildCashoutRow(customId)],
    });

    const collector = gameMessage.createMessageComponentCollector({
      time: 30000,
    });

    collector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.customId !== customId) return;

      if (buttonInteraction.user.id !== userId) {
        return buttonInteraction.reply({
          content: "This is not your Origin Crash game.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (gameEnded) {
        return buttonInteraction.reply({
          content: "This crash game has already ended.",
          flags: MessageFlags.Ephemeral,
        });
      }

      gameEnded = true;
      clearGameLoop();
      collector.stop("cashed");

      const payout = Math.floor(bet * multiplier);
      await addCoins(userId, payout);

      const jackpotResult = await tryWinJackpot(userId);
      const newJackpotAmount = await getJackpot();

      let finalDescription =
        `You cashed out at **${multiplier.toFixed(2)}x**.\n\n` +
        `You won **${formatOC(payout)} OC**.`;

      if (jackpotResult.won) {
        finalDescription += `\n\nYou also hit the **Origin Jackpot** and won **${formatOC(jackpotResult.amount)} OC**.`;
      }

      const finalEmbed = buildEmbed({
        user: interaction.user,
        bet,
        multiplier,
        status: "cashed",
        crashPoint,
        payout,
        jackpotAmount: newJackpotAmount,
      }).setDescription(finalDescription);

      try {
        await buttonInteraction.update({
          embeds: [finalEmbed],
          components: [buildCashoutRow(customId, true)],
        });
      } catch (error) {
        console.error("Crash cashout update error:", error);
      }

      await gameChannel.send({
        content: `Game complete. This private room will close shortly.`,
      });

      deleteGameRoom(gameChannel, 15000);
    });

    collector.on("end", async (_, reason) => {
      clearGameLoop();

      if (!gameEnded && reason !== "crashed") {
        gameEnded = true;

        const currentJackpot = await getJackpot();

        const timeoutEmbed = buildEmbed({
          user: interaction.user,
          bet,
          multiplier,
          status: "crashed",
          crashPoint: multiplier,
          payout: 0,
          jackpotAmount: currentJackpot,
        }).setDescription(
          `You did not cash out in time.\n\nYou lost **${formatOC(bet)} OC**.`
        );

        try {
          await gameMessage.edit({
            embeds: [timeoutEmbed],
            components: [buildCashoutRow(customId, true)],
          });
        } catch (error) {
          console.error("Crash timeout edit error:", error);
        }

        await gameChannel.send({
          content: `Game timed out. This private room will close shortly.`,
        });

        deleteGameRoom(gameChannel, 15000);
      }
    });

    gameLoop = setInterval(async () => {
      if (gameEnded) {
        clearGameLoop();
        return;
      }

      multiplier = +(multiplier + 0.12 + Math.random() * 0.16).toFixed(2);

      if (multiplier >= crashPoint) {
        gameEnded = true;
        clearGameLoop();
        collector.stop("crashed");

        const currentJackpot = await getJackpot();

        const crashEmbed = buildEmbed({
          user: interaction.user,
          bet,
          multiplier: crashPoint,
          status: "crashed",
          crashPoint,
          payout: 0,
          jackpotAmount: currentJackpot,
        });

        try {
          await gameMessage.edit({
            embeds: [crashEmbed],
            components: [buildCashoutRow(customId, true)],
          });
        } catch (error) {
          console.error("Crash final crash edit error:", error);
        }

        await gameChannel.send({
          content: `Crashed. This private room will close shortly.`,
        });

        deleteGameRoom(gameChannel, 15000);
        return;
      }

      const currentJackpot = await getJackpot();

      const runningEmbed = buildEmbed({
        user: interaction.user,
        bet,
        multiplier,
        status: "running",
        crashPoint,
        payout: 0,
        jackpotAmount: currentJackpot,
      });

      await safeEdit(gameMessage, {
        embeds: [runningEmbed],
        components: [buildCashoutRow(customId)],
      });
    }, TICK_MS);
  },
};