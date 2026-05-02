const pool = require("../db/pool");
const { formatCurrency } = require("../config/currency");

let leaderboardMessageId = null;
let secondsUntilUpdate = 60;

const UPDATE_SECONDS = 60;
const TIMER_TICK_SECONDS = 10;

function buildProgressBar(secondsLeft) {
  const totalBlocks = 12;
  const progress = secondsLeft / UPDATE_SECONDS;
  const filledBlocks = Math.ceil(progress * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;

  let barColor = "🟩";

  if (progress <= 0.5) barColor = "🟨";
  if (progress <= 0.2) barColor = "🟥";

  let bar = barColor.repeat(filledBlocks) + "⬛".repeat(emptyBlocks);

  if (secondsLeft <= 10) {
    bar = (secondsLeft % 4 === 0 ? "⚠️ " : "") + bar;
  }

  return bar;
}

async function buildLeaderboardText() {
  const result = await pool.query(
    "SELECT username, eggs FROM users ORDER BY eggs DESC LIMIT 10"
  );

  let text = "🎰 **LIVE EGGHUB CASINO LEADERBOARD** 🎰\n\n";

  if (result.rows.length === 0) {
    text += "No players found yet.";
  } else {
    result.rows.forEach((user, index) => {
      const place =
        index === 0 ? "🥇" :
        index === 1 ? "🥈" :
        index === 2 ? "🥉" :
        `**${index + 1}.**`;

      text += `${place} **${user.username}** — ${formatCurrency(user.eggs)}\n`;
    });
  }

  text += "\n⏱️ Updates automatically every 60 seconds.";
  text += `\n⏳ Next update in **${secondsUntilUpdate} seconds**.`;
  text += `\n${buildProgressBar(secondsUntilUpdate)}`;
  text += "\n💬 Stay active to climb the casino board.";
  text += "\n🎁 Top players may win bonus drops and prizes.";

  return text;
}

async function startLiveLeaderboard(client) {
  const channelId = process.env.LEADERBOARD_CHANNEL_ID;

  if (!channelId) {
    console.log("LEADERBOARD_CHANNEL_ID missing. Live leaderboard disabled.");
    return;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) {
    console.log("Leaderboard channel not found. Check LEADERBOARD_CHANNEL_ID.");
    return;
  }

  async function updateLeaderboard() {
    try {
      secondsUntilUpdate = UPDATE_SECONDS;

      const text = await buildLeaderboardText();

      if (leaderboardMessageId) {
        const existingMessage = await channel.messages
          .fetch(leaderboardMessageId)
          .catch(() => null);

        if (existingMessage) {
          await existingMessage.edit(text);
          return;
        }
      }

      const messages = await channel.messages.fetch({ limit: 20 });

      const existingLeaderboard = messages.find((msg) =>
        msg.author.id === client.user.id &&
        msg.content.includes("LIVE EGGHUB CASINO LEADERBOARD")
      );

      if (existingLeaderboard) {
        leaderboardMessageId = existingLeaderboard.id;
        await existingLeaderboard.edit(text);
        return;
      }

      const newMessage = await channel.send(text);
      leaderboardMessageId = newMessage.id;
    } catch (error) {
      console.error("Live leaderboard update error:", error);
    }
  }

  async function updateTimerOnly() {
    try {
      if (!leaderboardMessageId) return;

      const existingMessage = await channel.messages
        .fetch(leaderboardMessageId)
        .catch(() => null);

      if (!existingMessage) return;

      const text = await buildLeaderboardText();
      await existingMessage.edit(text);
    } catch (error) {
      console.error("Live leaderboard timer update error:", error);
    }
  }

  await updateLeaderboard();

  setInterval(async () => {
    secondsUntilUpdate -= TIMER_TICK_SECONDS;

    if (secondsUntilUpdate <= 0) {
      await updateLeaderboard();
      return;
    }

    await updateTimerOnly();
  }, TIMER_TICK_SECONDS * 1000);

  console.log("Live casino leaderboard started.");
}

module.exports = startLiveLeaderboard;