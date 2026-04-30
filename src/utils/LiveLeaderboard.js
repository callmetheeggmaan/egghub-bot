const pool = require("../db/pool");

let leaderboardMessageId = null;

async function buildLeaderboardText() {
  const result = await pool.query(
    "SELECT username, eggs FROM users ORDER BY eggs DESC LIMIT 10"
  );

  let text = "🏆 **LIVE EGGHUB LEADERBOARD** 🏆\n\n";

  if (result.rows.length === 0) {
    text += "No users found yet.";
    return text;
  }

  result.rows.forEach((user, index) => {
    const place =
      index === 0 ? "🥇" :
      index === 1 ? "🥈" :
      index === 2 ? "🥉" :
      `**${index + 1}.**`;

    text += `${place} **${user.username}** — 🥚 ${user.eggs}\n`;
  });

  text += "\n⏱️ Updates automatically every 60 seconds.";
  text += "\n💬 Stay active to climb the leaderboard.";
  text += "\n🎁 Top players may win prizes.";

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

      const existingLeaderboard = messages.find(msg =>
        msg.author.id === client.user.id &&
        msg.content.includes("LIVE EGGHUB LEADERBOARD")
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

  await updateLeaderboard();

  setInterval(updateLeaderboard, 60 * 1000);

  console.log("Live leaderboard started.");
}

module.exports = startLiveLeaderboard;