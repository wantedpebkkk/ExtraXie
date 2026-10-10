const {
  Client,
  GatewayIntentBits,
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.COMMAND_PREFIX || '!';
const configuredWelcomeChannelId = process.env.WELCOME_CHANNEL_ID;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN environment variable.');
}

const dataDir = path.join(__dirname, 'data');
const dataFilePath = path.join(dataDir, 'members.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const state = {
  members: {},
};

function loadState() {
  if (!fs.existsSync(dataFilePath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && parsed.members) {
      state.members = parsed.members;
    }
  } catch (error) {
    console.error('Failed to load state file:', error);
  }
}

function saveState() {
  const payload = JSON.stringify({ members: state.members }, null, 2);
  fs.writeFileSync(dataFilePath, payload);
}

function getMemberStats(memberId) {
  if (!state.members[memberId]) {
    state.members[memberId] = {
      xp: 0,
      level: 1,
      messageCount: 0,
      voiceSeconds: 0,
      voiceJoinAt: null,
    };
  }

  return state.members[memberId];
}

function xpForNextLevel(level) {
  return 100 * level;
}

function addXp(memberId, amount) {
  const stats = getMemberStats(memberId);
  stats.xp += amount;

  let leveledUp = false;
  while (stats.xp >= xpForNextLevel(stats.level)) {
    stats.xp -= xpForNextLevel(stats.level);
    stats.level += 1;
    leveledUp = true;
  }

  return { stats, leveledUp };
}

function addVoiceTime(memberId, seconds) {
  const stats = getMemberStats(memberId);
  stats.voiceSeconds += Math.max(0, Math.floor(seconds));
}

function formatVoiceHours(seconds) {
  return (seconds / 3600).toFixed(2);
}

function parseEmbedColor(input) {
  if (!input) {
    return 0x5865f2;
  }

  const cleaned = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return null;
  }

  return Number.parseInt(cleaned, 16);
}

function createLeaderboardEmbed(guild, sortBy, entries) {
  const labels = {
    xp: 'XP',
    messageCount: 'Messages',
    voiceSeconds: 'Voice Hours',
  };

  const lines = entries.map(([memberId, stats], index) => {
    const rank = index + 1;
    const member = guild.members.cache.get(memberId);
    const displayName = member ? member.displayName : `Unknown (${memberId})`;

    let value;
    if (sortBy === 'voiceSeconds') {
      value = `${formatVoiceHours(stats.voiceSeconds)}h`;
    } else {
      value = `${stats[sortBy] ?? 0}`;
    }

    return `**${rank}.** ${displayName} — ${value}`;
  });

  return new EmbedBuilder()
    .setTitle(`Leaderboard • ${labels[sortBy]}`)
    .setDescription(lines.length ? lines.join('\n') : 'No data yet.')
    .setColor(0x00a2ff)
    .setTimestamp(new Date());
}

async function sendWelcomeMessage(member) {
  const guild = member.guild;
  let channel = null;

  if (configuredWelcomeChannelId) {
    channel = guild.channels.cache.get(configuredWelcomeChannelId) || null;
  }

  if (!channel) {
    channel = guild.systemChannel;
  }

  if (!channel) {
    channel = guild.channels.cache.find((candidate) => {
      if (candidate.type !== ChannelType.GuildText) {
        return false;
      }

      const perms = candidate.permissionsFor(guild.members.me);
      return (
        perms &&
        perms.has(PermissionsBitField.Flags.SendMessages) &&
        perms.has(PermissionsBitField.Flags.ViewChannel)
      );
    }) || null;
  }

  if (!channel) {
    return;
  }

  const message = `🎉 Welcome ${member} to **${guild.name}**!\nUse \`${prefix}leaderboard\` and \`${prefix}stats\` to see your progress.`;
  await channel.send({ content: message });
}

loadState();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('guildMemberAdd', async (member) => {
  getMemberStats(member.id);
  saveState();

  try {
    await sendWelcomeMessage(member);
  } catch (error) {
    console.error('Failed to send welcome message:', error);
  }
});

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) {
    return;
  }

  const xpGain = 10 + Math.floor(Math.random() * 11);
  const { stats, leveledUp } = addXp(message.author.id, xpGain);
  stats.messageCount += 1;
  saveState();

  if (leveledUp) {
    await message.channel.send(`⬆️ ${message.member} reached **Level ${stats.level}**!`);
  }

  if (!message.content.startsWith(prefix)) {
    return;
  }

  const commandInput = message.content.slice(prefix.length).trim();
  if (!commandInput) {
    return;
  }

  const [command, ...args] = commandInput.split(/\s+/);
  const normalized = command?.toLowerCase();
  const commandBody = commandInput.slice(command.length).trim();

  if (normalized === 'stats' || normalized === 'rank') {
    const mentioned = message.mentions.members.first();
    const targetMember = mentioned || message.member;
    const targetStats = getMemberStats(targetMember.id);

    await message.channel.send(
      `📊 **${targetMember.displayName}**\n` +
        `• Level: ${targetStats.level}\n` +
        `• XP: ${targetStats.xp}/${xpForNextLevel(targetStats.level)}\n` +
        `• Messages: ${targetStats.messageCount}\n` +
        `• Voice Hours: ${formatVoiceHours(targetStats.voiceSeconds)}h`
    );

    return;
  }

  if (normalized === 'leaderboard' || normalized === 'lb') {
    const mode = (args[0] || 'xp').toLowerCase();
    const sortBy =
      mode === 'messages' || mode === 'message' || mode === 'msg'
        ? 'messageCount'
        : mode === 'voice' || mode === 'vc'
        ? 'voiceSeconds'
        : 'xp';

    await message.guild.members.fetch();

    const entries = Object.entries(state.members)
      .sort((a, b) => {
        const aStats = a[1];
        const bStats = b[1];

        if (sortBy === 'xp') {
          if (bStats.level !== aStats.level) {
            return bStats.level - aStats.level;
          }
        }

        return (bStats[sortBy] || 0) - (aStats[sortBy] || 0);
      })
      .slice(0, 10);

    const embed = createLeaderboardEmbed(message.guild, sortBy, entries);
    await message.channel.send({ embeds: [embed] });

    return;
  }

  if (normalized === 'embed' || normalized === 'sayembed') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
      await message.channel.send('❌ You need the **Manage Messages** permission to use this command.');
      return;
    }

    const [title = '', description = '', colorInput = ''] = commandBody.split('|').map((part) => part.trim());
    if (!title || !description) {
      await message.channel.send(
        `Usage: \`${prefix}embed Title | Description | #5865F2\` (color is optional).`
      );
      return;
    }

    const color = parseEmbedColor(colorInput);
    if (color === null) {
      await message.channel.send('❌ Color must be a 6-digit hex value like `#5865F2`.');
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title.slice(0, 256))
      .setDescription(description.slice(0, 4096))
      .setColor(color)
      .setTimestamp(new Date())
      .setFooter({ text: `Sent by ${message.member.displayName}` });

    await message.channel.send({ embeds: [embed] });
    return;
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const memberId = newState.id;
  const stats = getMemberStats(memberId);

  if (!oldChannelId && newChannelId) {
    stats.voiceJoinAt = Date.now();
    saveState();
    return;
  }

  if (oldChannelId && !newChannelId && stats.voiceJoinAt) {
    const elapsedSeconds = (Date.now() - stats.voiceJoinAt) / 1000;
    addVoiceTime(memberId, elapsedSeconds);
    stats.voiceJoinAt = null;
    saveState();
    return;
  }

  if (oldChannelId && newChannelId && oldChannelId !== newChannelId && stats.voiceJoinAt) {
    const elapsedSeconds = (Date.now() - stats.voiceJoinAt) / 1000;
    addVoiceTime(memberId, elapsedSeconds);
    stats.voiceJoinAt = Date.now();
    saveState();
  }
});

function flushVoiceSessions() {
  const now = Date.now();
  Object.values(state.members).forEach((stats) => {
    if (stats.voiceJoinAt) {
      const elapsedSeconds = (now - stats.voiceJoinAt) / 1000;
      stats.voiceSeconds += Math.max(0, Math.floor(elapsedSeconds));
      stats.voiceJoinAt = now;
    }
  });

  saveState();
}

setInterval(flushVoiceSessions, 60 * 1000);

process.on('SIGINT', () => {
  flushVoiceSessions();
  process.exit(0);
});

process.on('SIGTERM', () => {
  flushVoiceSessions();
  process.exit(0);
});

client.login(token);
