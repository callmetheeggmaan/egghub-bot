const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const pool = require("../db/pool");

function randomCrashPoint() {
  const roll = Math.random();

  if (roll < 0.45) return Number((1 + Math.random() * 0.7).toFixed(2)); // 1.00x - 1.70x
  if (roll < 0.75) return Number((1.7 + Math.random() * 1.3).toFixed(2)); // 1.70x - 3.00x
  if (roll < 0.92) return Number((3 + Math.random() * 3).toFixed(2)); // 3.00x - 6.00x
  if (roll < 0.98) return Number((6 + Math.random() * 6).toFixed(2)); // 6.00x - 12.00x

  return Number((12 + Math.random() * 13).toFixed(2)); // 12.00x - 25.00x
}

function makeProgressBar(multiplier, crashPoint, crashed = false) {
  const maxBlocks = 12;
  const progress = Math.min(Math.floor((multiplier / Math.max(crashPoint, 2)) * maxBlocks), maxBlocks);

  let bar = "";

  for (let i = 0; i < maxBlocks; i++) {
    if (i === progress && !crashed) {
      bar += "🚀";
    } else if (i < progress) {
      bar += "━";
    } else {
      bar += "─";
    }
  }

  return crashed ? `${bar} 💥` : `${bar} 💰`;
}

function makeEmbed({ user, bet, multiplier, potentialWin, crashPoint, status }) {
  let colour = 0xf1c40f;
  let title = "🚀 EGG CRASH";
  let description = "Cash out before it crashes.";

  if (status === "cashed") {
    colour = 0x2ecc71;
    title = "✅ CASHED OUT";
    description = `${user} escaped before the crash.`;
  }

  if (status === "crashed") {
    colour = 0xe74c3c;
    title = "💥 CRASHED";
    description = `${user} waited too long.`;
  }

  return new EmbedBuilder()
    .setColor(colour)
    .setTitle(title)
    .setDescription(description)
    .addFields(
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
        value: makeProgressBar(multiplier, crashPoint, status === "crashed"),
        inline: false,
      }
    )
    .setFooter({
      text: status === "playing"
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

    if (bet < 10) {
      return interaction.reply({
        content: "Minimum bet is 10 Eggs.",
        ephemeral: true,
      });
    }

    if (bet > 1000) {
      return interaction.reply({
        content: "Maximum bet is 1000 Eggs.",
        ephemeral: true,
      });
    }

    try {
      const result = await pool.query(
        "SELECT eggs FROM users WHERE discord_id = $1",
        [userId]
      );

      if (result.rows.length === 0) {
        return interaction.reply({
          content: "You have no Eggs yet.",
          ephemeral: true,
        });
      }

      const currentEggs = result.rows[0].eggs;

      if (currentEggs < bet) {
        return interaction.reply({
          content: `You only have ${currentEggs} Eggs.`,
          ephemeral: true,
        });
      }

      await pool.query(
        "UPDATE users SET eggs = eggs - $1, username = $2 WHERE discord_id = $3",
        [bet, username, userId]
      );

      let multiplier = 1.0;
      let cashedOut = false;
      let crashed = false;

      const crashPoint = randomCrashPoint();

      const cashoutButton = new ButtonBuilder()
        .setCustomId(`crash_cashout_${userId}`)
        .setLabel("CASH OUT")
        .setStyle(ButtonStyle.Success)
        .setEmoji("💰");

      const row = new ActionRowBuilder().addComponents(cashoutButton);

      const startingEmbed = makeEmbed({
        user: interaction.user,
        bet,
        multiplier,
        potentialWin: bet,
        crashPoint,
        status: "playing",
      });

      await interaction.reply({
        embeds: [startingEmbed],
        components: [row],
      });

      const message = await interaction.fetchReply();

      const collector = message.createMessageComponentCollector({
        time: 30000,
      });

      collector.on("collect", async buttonInteraction => {
        if (buttonInteraction.user.id !== userId) {
          return buttonInteraction.reply({
            content: "This is not your Crash game.",
            ephemeral: true,
          });
        }

        if (cashedOut || crashed) {
          return buttonInteraction.reply({
            content: "This game is already over.",
            ephemeral: true,
          });
        }

        cashedOut = true;

        const winnings = Math.floor(bet * multiplier);

        await pool.query(
          "UPDATE users SET eggs = eggs + $1 WHERE discord_id = $2",
          [winnings, userId]
        );

        const disabledButton = ButtonBuilder.from(cashoutButton)
          .setDisabled(true)
          .setLabel("CASHED OUT");

        const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

        const cashedEmbed = makeEmbed({
          user: interaction.user,
          bet,
          multiplier,
          potentialWin: winnings,
          crashPoint,
          status: "cashed",
        });

        await buttonInteraction.update({
          embeds: [cashedEmbed],
          components: [disabledRow],
        });

        collector.stop("cashed");
      });

      const gameLoop = setInterval(async () => {
        if (cashedOut || crashed) {
          clearInterval(gameLoop);
          return;
        }

        const growth = 0.08 + Math.random() * 0.22;
        multiplier = Number((multiplier + growth).toFixed(2));

        const potentialWin = Math.floor(bet * multiplier);

        if (multiplier >= crashPoint) {
          crashed = true;
          clearInterval(gameLoop);

          const disabledButton = ButtonBuilder.from(cashoutButton)
            .setDisabled(true)
            .setLabel("CRASHED");

          const disabledRow = new ActionRowBuilder().addComponents(disabledButton);

          const crashedEmbed = makeEmbed({
            user: interaction.user,
            bet,
            multiplier: crashPoint,
            potentialWin: 0,
            crashPoint,
            status: "crashed",
          });

          await message.edit({
            embeds: [crashedEmbed],
            components: [disabledRow],
          }).catch(() => null);

          collector.stop("crashed");
          return;
        }

        const liveEmbed = makeEmbed({
          user: interaction.user,
          bet,
          multiplier,
          potentialWin,
          crashPoint,
          status: "playing",
        });

        await message.edit({
          embeds: [liveEmbed],
          components: [row],
        }).catch(() => null);

      }, 1200);

      collector.on("end", async () => {
        clearInterval(gameLoop);
      });

    } catch (error) {
      console.error("Crash command error:", error);

      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({
          content: "Crash game failed.",
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: "Crash game failed.",
        ephemeral: true,
      });
    }
  },
};