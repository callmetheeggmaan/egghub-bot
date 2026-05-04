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
const ROOM_CLOSE_DELAY = 60000;

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

  if (Math.random() <= 0.01) {
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
  let color = 0xd4af37;

  if (status === "waiting") {
    description =
      `Private Origin Crash room ready.\n\n` +
      `Bet: **${formatOC(bet)} OC**\n\n` +
      `Press **Start Crash** when ready.`;
  }

  if (status === "running") {
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
    description =
      `You cashed out at **${multiplier.toFixed(2)}x**.\n\n` +
      `You won **${formatOC(payout)} OC**.`;
  }

  return new EmbedBuilder()
    .setTitle("ORIGIN CRASH")
    .setColor(color)
    .setDescription(description)
    .addFields(
      { name: "Player", value: `${user}`, inline: true },
      { name: "Bet", value: `${formatOC(bet)} OC`, inline: true },
      { name: "Jackpot", value: `${formatOC(jackpotAmount)} OC`, inline: true }
    )
    .setFooter({ text: "Origin Casino • Private game room" })
    .setTimestamp();
}

function buildStartRow(startId, closeId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(startId)
      .setLabel("Start Crash")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(closeId)
      .setLabel("Close Room")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildCashoutRow(cashoutId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(cashoutId)
      .setLabel("Cash Out")
      .setStyle(ButtonStyle.Success)
  );
}

function buildAfterGameRow(playAgainId, closeId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(playAgainId)
      .setLabel("Play Again")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(closeId)
      .setLabel("Close Room")
      .setStyle(ButtonStyle.Danger)
  );
}

function buildGoToRoomRow(channelUrl) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel("Go To Game Room")
      .setStyle(ButtonStyle.Link)
      .setURL(channelUrl)
  );
}

async function showWaitingPanel({ panelMessage, interaction, bet }) {
  const userId = interaction.user.id;

  const jackpotAmount = await getJackpot();
  const startId = `origin_crash_start_${userId}_${Date.now()}`;
  const closeId = `origin_crash_close_${userId}_${Date.now()}`;

  const embed = buildEmbed({
    user: interaction.user,
    bet,
    multiplier: 1,
    status: "waiting",
    crashPoint: 0,
    payout: 0,
    jackpotAmount,
  });

  await panelMessage.edit({
    content: `${interaction.user}, your Origin Crash table is ready.`,
    embeds: [embed],
    components: [buildStartRow(startId, closeId)],
  });

  const collector = panelMessage.createMessageComponentCollector({
    time: ROOM_CLOSE_DELAY,
  });

  collector.on("collect", async (buttonInteraction) => {
    if (buttonInteraction.user.id !== userId) {
      return buttonInteraction.reply({
        content: "This is not your Origin game room.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (buttonInteraction.customId === closeId) {
      collector.stop("closed");

      await buttonInteraction.update({
        content: "Closing this private room now.",
        embeds: [],
        components: [],
      });

      deleteGameRoom(panelMessage.channel, 1000);
      return;
    }

    if (buttonInteraction.customId === startId) {
      collector.stop("started");

      await buttonInteraction.update({
        content: `${interaction.user}, Origin Crash is starting...`,
        components: [],
      });

      await runCrashRound({
        panelMessage,
        interaction,
        bet,
      });
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "started" && reason !== "closed") {
      deleteGameRoom(panelMessage.channel, 1000);
    }
  });
}

async function runCrashRound({ panelMessage, interaction, bet }) {
  const userId = interaction.user.id;

  const balance = await getBalance(userId);

  if (balance < bet) {
    await panelMessage.edit({
      content: `${interaction.user}, you do not have enough OC. Your balance is **${formatOC(balance)} OC**.`,
      embeds: [],
      components: [],
    });

    deleteGameRoom(panelMessage.channel, 10000);
    return;
  }

  await removeCoins(userId, bet);

  const jackpotFeed = Math.max(1, Math.floor(bet * 0.05));
  await addToJackpot(jackpotFeed);

  const crashPoint = makeCrashPoint();

  let multiplier = 1.0;
  let gameEnded = false;
  let editLocked = false;
  let gameLoop = null;

  const cashoutId = `origin_crash_cashout_${userId}_${Date.now()}`;
  const playAgainId = `origin_crash_again_${userId}_${Date.now()}`;
  const closeId = `origin_crash_close_${userId}_${Date.now()}`;

  const clearGameLoop = () => {
    if (gameLoop) {
      clearInterval(gameLoop);
      gameLoop = null;
    }
  };

  const safeEdit = async (payload) => {
    if (editLocked || gameEnded) return;

    editLocked = true;

    try {
      await panelMessage.edit(payload);
    } catch (error) {
      console.error("Crash panel edit error:", error);
    } finally {
      editLocked = false;
    }
  };

  const runningEmbed = buildEmbed({
    user: interaction.user,
    bet,
    multiplier,
    status: "running",
    crashPoint,
    payout: 0,
    jackpotAmount: await getJackpot(),
  });

  await panelMessage.edit({
    content: `${interaction.user}, your Origin Crash game is live.`,
    embeds: [runningEmbed],
    components: [buildCashoutRow(cashoutId)],
  });

  const collector = panelMessage.createMessageComponentCollector({
    time: 30000,
  });

  async function showAfterGame(text) {
    await panelMessage.edit({
      content: text,
      components: [buildAfterGameRow(playAgainId, closeId)],
    });

    const afterCollector = panelMessage.createMessageComponentCollector({
      time: ROOM_CLOSE_DELAY,
    });

    afterCollector.on("collect", async (buttonInteraction) => {
      if (buttonInteraction.user.id !== userId) {
        return buttonInteraction.reply({
          content: "This is not your Origin game room.",
          flags: MessageFlags.Ephemeral,
        });
      }

      if (buttonInteraction.customId === closeId) {
        afterCollector.stop("closed");

        await buttonInteraction.update({
          content: "Closing this private room now.",
          embeds: [],
          components: [],
        });

        deleteGameRoom(panelMessage.channel, 1000);
        return;
      }

      if (buttonInteraction.customId === playAgainId) {
        afterCollector.stop("again");

        await buttonInteraction.update({
          content: `Resetting Origin Crash with the same bet: **${formatOC(bet)} OC**.`,
          embeds: [],
          components: [],
        });

        await showWaitingPanel({
          panelMessage,
          interaction,
          bet,
        });
      }
    });

    afterCollector.on("end", async (_, reason) => {
      if (reason !== "again" && reason !== "closed") {
        deleteGameRoom(panelMessage.channel, 1000);
      }
    });
  }

  collector.on("collect", async (buttonInteraction) => {
    if (buttonInteraction.customId !== cashoutId) return;

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

    await buttonInteraction.update({
      content: `${interaction.user}, round complete.`,
      embeds: [finalEmbed],
      components: [],
    });

    await showAfterGame("Round complete. Play again or close the room.");
  });

  collector.on("end", async (_, reason) => {
    clearGameLoop();

    if (!gameEnded && reason !== "crashed") {
      gameEnded = true;

      const timeoutEmbed = buildEmbed({
        user: interaction.user,
        bet,
        multiplier,
        status: "crashed",
        crashPoint: multiplier,
        payout: 0,
        jackpotAmount: await getJackpot(),
      }).setDescription(
        `You did not cash out in time.\n\nYou lost **${formatOC(bet)} OC**.`
      );

      await panelMessage.edit({
        content: `${interaction.user}, round timed out.`,
        embeds: [timeoutEmbed],
        components: [],
      });

      await showAfterGame("Round timed out. Play again or close the room.");
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

      const crashEmbed = buildEmbed({
        user: interaction.user,
        bet,
        multiplier: crashPoint,
        status: "crashed",
        crashPoint,
        payout: 0,
        jackpotAmount: await getJackpot(),
      });

      await panelMessage.edit({
        content: `${interaction.user}, crashed.`,
        embeds: [crashEmbed],
        components: [],
      });

      await showAfterGame("Crashed. Play again or close the room.");
      return;
    }

    const liveEmbed = buildEmbed({
      user: interaction.user,
      bet,
      multiplier,
      status: "running",
      crashPoint,
      payout: 0,
      jackpotAmount: await getJackpot(),
    });

    await safeEdit({
      content: `${interaction.user}, your Origin Crash game is live.`,
      embeds: [liveEmbed],
      components: [buildCashoutRow(cashoutId)],
    });
  }, TICK_MS);
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
        components: [buildGoToRoomRow(roomResult.channel.url)],
      });
    }

    const gameChannel = roomResult.channel;

    await interaction.editReply({
      content: `Your private Origin Crash room is ready: ${gameChannel}`,
      components: [buildGoToRoomRow(gameChannel.url)],
    });

    const panelMessage = await gameChannel.send({
      content: `${interaction.user}, loading your Origin Crash table...`,
    });

    await showWaitingPanel({
      panelMessage,
      interaction,
      bet,
    });
  },
};