const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");

const play = require("play-dl");
const ytdl = require("@distube/ytdl-core");

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

function formatDuration(seconds) {
  const totalSeconds = Number(seconds);

  if (!totalSeconds || Number.isNaN(totalSeconds)) {
    return "Unknown";
  }

  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

async function resolveSong(query) {
  if (ytdl.validateURL(query)) {
    const info = await ytdl.getInfo(query);

    return {
      title: info.videoDetails.title,
      url: info.videoDetails.video_url,
      duration: formatDuration(info.videoDetails.lengthSeconds),
    };
  }

  const results = await play.search(query, {
    limit: 1,
    source: { youtube: "video" },
  });

  if (!results || results.length === 0 || !results[0].url) {
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
      const latestQueue = queues.get(guildId);

      if (!latestQueue) return;

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
    if (!ytdl.validateURL(song.url)) {
      throw new Error("Invalid YouTube URL from search result.");
    }

    const stream = ytdl(song.url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });

    const resource = createAudioResource(stream, {
      inputType: StreamType.Arbitrary,
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
  const guild = interaction.guild;

  if (!guild) {
    return { error: "This command can only be used inside a server." };
  }

  let member;

  try {
    member = await guild.members.fetch(interaction.user.id);
  } catch (err) {
    console.error("Failed to fetch guild member:", err);
    return { error: "I could not check your voice channel. Try again." };
  }

  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    return { error: "You need to join a voice channel first." };
  }

  const permissions = voiceChannel.permissionsFor(guild.members.me);

  if (!permissions || !permissions.has("Connect") || !permissions.has("Speak")) {
    return {
      error: "I need permission to Connect and Speak in your voice channel.",
    };
  }

  const song = await resolveSong(query);

  if (song.error) {
    return { error: song.error };
  }

  const queue = getQueue(guild.id);

  queue.textChannel = interaction.channel;
  queue.voiceChannel = voiceChannel;

  if (!queue.connection) {
    queue.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    try {
      await entersState(queue.connection, VoiceConnectionStatus.Ready, 15_000);
    } catch (err) {
      console.error("Voice connection failed:", err);

      queue.connection.destroy();
      queues.delete(guild.id);

      return {
        error: "I could not connect to your voice channel.",
      };
    }

    queue.connection.subscribe(queue.player);

    queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        if (queue.connection) queue.connection.destroy();
        queues.delete(guild.id);
      }
    });

    queue.player.on(AudioPlayerStatus.Idle, () => {
      playNext(guild.id);
    });

    queue.player.on("error", error => {
      console.error("Audio player error:", error);
      playNext(guild.id);
    });
  }

  queue.songs.push(song);

  if (!queue.playing && !queue.current) {
    playNext(guild.id);
  }

  return {
    song,
    position: queue.songs.length,
  };
}

function skipSong(guildId) {
  const queue = queues.get(guildId);

  if (!queue || !queue.connection || !queue.current) {
    return { error: "Nothing is currently playing." };
  }

  queue.player.stop();
  return { success: true };
}

function stopMusic(guildId) {
  const queue = queues.get(guildId);

  if (!queue || !queue.connection) {
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
  const queue = queues.get(guildId);

  if (!queue) {
    return {
      current: null,
      songs: [],
      playing: false,
    };
  }

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