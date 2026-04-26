const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("test-join")
    .setDescription("Simulate a user join"),

  async execute(interaction) {
    const member = interaction.member;

    const welcomeChannelId = process.env.WELCOME_CHANNEL_ID;
    const starterRoleId = process.env.STARTER_ROLE_ID;

    if (starterRoleId) {
      const role = interaction.guild.roles.cache.get(starterRoleId);
      if (role) await member.roles.add(role);
    }

    if (welcomeChannelId) {
      const channel = interaction.guild.channels.cache.get(welcomeChannelId);
      if (channel) {
        await channel.send(`🧪 Test welcome for ${member}`);
      }
    }

    await interaction.reply({ content: "Test join executed", ephemeral: true });
  },
};