const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");

const play = require("play-dl");

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      connection: null,
      player: createAudioPlayer(),
      songs: [],
      current: null,
      textChannel: null,
      voiceChannel: null,
      playing: false,
    });
  }

  return queues.get(guildId);
}

async function resolveSong(query) {
  if (play.yt_validate(query) === "video") {
    const info = await play.video_info(query);

    return {
      title: info.video_details.title,
      url: info.video_details.url,
      duration: info.video_details.durationRaw || "Unknown",
    };
  }

  const results = await play.search(query, {
    limit: 1,
    source: { youtube: "video" },
  });

  if (!results || results.length === 0) {
    return { error: "No YouTube results found." };
  }

  return {
    title: results[0].title,
    url: results[0].url,
    duration: results[0].durationRaw || "Unknown",
  };
}

async function playNext(guildId) {
  const queue = getQueue(guildId);

  if (!queue.songs.length) {
    queue.current = null;
    queue.playing = false;

    setTimeout(() => {
      const latestQueue = getQueue(guildId);

      if (!latestQueue.playing && latestQueue.connection) {
        latestQueue.connection.destroy();
        queues.delete(guildId);
      }
    }, 60 * 1000);

    return;
  }

  const song = queue.songs.shift();
  queue.current = song;
  queue.playing = true;

  try {
    const stream = await play.stream(song.url, {
      discordPlayerCompatibility: true,
    });

    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    });

    queue.player.play(resource);

    if (queue.textChannel) {
      await queue.textChannel.send(
        `🎶 **Now Playing**\n**${song.title}**\n⏱️ ${song.duration}`
      );
    }
  } catch (err) {
    console.error("Music stream error:", err);

    if (queue.textChannel) {
      await queue.textChannel.send(
        `❌ Failed to play this track. Skipping...\n\`${err.message || "Unknown stream error"}\``
      );
    }

    playNext(guildId);
  }
}

async function addSong(interaction, query) {
  const member = interaction.member;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    return { error: "You need to join a voice channel first." };
  }

  const song = await resolveSong(query);

  if (song.error) {
    return { error: song.error };
  }

  const queue = getQueue(interaction.guild.id);

  queue.textChannel = interaction.channel;
  queue.voiceChannel = voiceChannel;

  if (!queue.connection) {
    queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    queue.connection.subscribe(queue.player);

    queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(queue.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(queue.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        if (queue.connection) queue.connection.destroy();
        queues.delete(interaction.guild.id);
      }
    });

    queue.player.on(AudioPlayerStatus.Idle, () => {
      playNext(interaction.guild.id);
    });

    queue.player.on("error", error => {
      console.error("Audio player error:", error);
      playNext(interaction.guild.id);
    });
  }

  queue.songs.push(song);

  if (!queue.playing && !queue.current) {
    playNext(interaction.guild.id);
  }

  return {
    song,
    position: queue.songs.length,
  };
}

function skipSong(guildId) {
  const queue = getQueue(guildId);

  if (!queue.connection || !queue.current) {
    return { error: "Nothing is currently playing." };
  }

  queue.player.stop();
  return { success: true };
}

function stopMusic(guildId) {
  const queue = getQueue(guildId);

  if (!queue.connection) {
    return { error: "Music is not currently playing." };
  }

  queue.songs = [];
  queue.current = null;
  queue.playing = false;

  queue.player.stop();

  if (queue.connection) {
    queue.connection.destroy();
  }

  queues.delete(guildId);

  return { success: true };
}

function getQueueInfo(guildId) {
  const queue = getQueue(guildId);

  return {
    current: queue.current,
    songs: queue.songs,
    playing: queue.playing,
  };
}

module.exports = {
  addSong,
  skipSong,
  stopMusic,
  getQueueInfo,
};