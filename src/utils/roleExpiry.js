const pool = require("../db/pool");

module.exports = async (client) => {
  setInterval(async () => {
    try {
      const result = await pool.query(
        "SELECT * FROM user_roles WHERE expires_at <= NOW()"
      );

      for (const row of result.rows) {
        const guild = client.guilds.cache.first();
        if (!guild) continue;

        const member = await guild.members.fetch(row.discord_id).catch(() => null);
        if (!member) continue;

        await member.roles.remove(row.role_id).catch(() => null);

        await pool.query(
          "DELETE FROM user_roles WHERE id = $1",
          [row.id]
        );

        console.log(`Removed expired role from ${row.discord_id}`);
      }
    } catch (err) {
      console.error("Expiry check error:", err);
    }
  }, 60 * 1000); // runs every 1 minute
};