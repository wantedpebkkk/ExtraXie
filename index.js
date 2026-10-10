const {
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionsBitField,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const token = process.env.DISCORD_TOKEN;
const prefix = process.env.COMMAND_PREFIX || '!';
const configuredWelcomeChannelId = process.env.WELCOME_CHANNEL_ID;
const configuredTempVcCreateChannelId = process.env.TEMP_VC_CREATE_CHANNEL_ID;
const tempVcCreateChannelName = process.env.TEMP_VC_CREATE_CHANNEL_NAME || '➕ Create VC';

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

const tempVoiceChannels = new Map();

function normalizeMemberStats(raw = {}) {
  return {
    xp: Number.isFinite(raw.xp) ? raw.xp : 0,
    level: Number.isFinite(raw.level) && raw.level > 0 ? raw.level : 1,
    messageCount: Number.isFinite(raw.messageCount) ? raw.messageCount : 0,
    voiceSeconds: Number.isFinite(raw.voiceSeconds) ? raw.voiceSeconds : 0,
    voiceJoinAt: Number.isFinite(raw.voiceJoinAt) ? raw.voiceJoinAt : null,
    afk: {
      active: Boolean(raw.afk?.active),
      reason: typeof raw.afk?.reason === 'string' ? raw.afk.reason : '',
      since: Number.isFinite(raw.afk?.since) ? raw.afk.since : null,
      afkCount: Number.isFinite(raw.afk?.afkCount) ? raw.afk.afkCount : 0,
      totalAfkSeconds: Number.isFinite(raw.afk?.totalAfkSeconds) ? raw.afk.totalAfkSeconds : 0,
      lastStartedAt: Number.isFinite(raw.afk?.lastStartedAt) ? raw.afk.lastStartedAt : null,
      lastEndedAt: Number.isFinite(raw.afk?.lastEndedAt) ? raw.afk.lastEndedAt : null,
    },
  };
}

function loadState() {
  if (!fs.existsSync(dataFilePath)) {
    return;
  }

  try {
    const raw = fs.readFileSync(dataFilePath, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed && typeof parsed === 'object' && parsed.members) {
      state.members = Object.fromEntries(
        Object.entries(parsed.members).map(([memberId, stats]) => [memberId, normalizeMemberStats(stats)])
      );
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
    state.members[memberId] = normalizeMemberStats();
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

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (!parts.length || secs) parts.push(`${secs}s`);
  return parts.join(' ');
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

function buildLeaderboardEntries(sortBy) {
  return Object.entries(state.members)
    .sort((a, b) => {
      const aStats = a[1];
      const bStats = b[1];

      if (sortBy === 'xp') {
        if (bStats.level !== aStats.level) {
          return bStats.level - aStats.level;
        }
      }

      const aValue =
        sortBy === 'afkCount'
          ? aStats.afk.afkCount
          : sortBy === 'totalAfkSeconds'
          ? aStats.afk.totalAfkSeconds
          : aStats[sortBy] || 0;
      const bValue =
        sortBy === 'afkCount'
          ? bStats.afk.afkCount
          : sortBy === 'totalAfkSeconds'
          ? bStats.afk.totalAfkSeconds
          : bStats[sortBy] || 0;

      return bValue - aValue;
    })
    .slice(0, 10);
}

function createLeaderboardEmbed(guild, sortBy, entries) {
  const labels = {
    xp: 'XP',
    messageCount: 'Messages',
    voiceSeconds: 'Voice Hours',
    afkCount: 'AFK Count',
    totalAfkSeconds: 'AFK Time',
  };

  const lines = entries.map(([memberId, stats], index) => {
    const rank = index + 1;
    const member = guild.members.cache.get(memberId);
    const displayName = member ? member.displayName : `Unknown (${memberId})`;

    let value;
    if (sortBy === 'voiceSeconds') {
      value = `${formatVoiceHours(stats.voiceSeconds)}h`;
    } else if (sortBy === 'afkCount') {
      value = `${stats.afk.afkCount}`;
    } else if (sortBy === 'totalAfkSeconds') {
      value = formatDuration(stats.afk.totalAfkSeconds);
    } else if (sortBy === 'xp') {
      value = `Lv.${stats.level} • ${stats.xp}xp`;
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

function createVcPanelEmbed(member) {
  return new EmbedBuilder()
    .setTitle('Voice Channel Control Panel')
    .setDescription(
      [
        `Use these controls while inside your temporary VC.`,
        `• Owner: ${member}`,
        `• Join **${tempVcCreateChannelName}** to create your VC`,
      ].join('\n')
    )
    .setColor(0x00c26e)
    .setTimestamp(new Date());
}

function createVcControlRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc_lock').setLabel('Lock VC').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vc_unlock').setLabel('Unlock VC').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vc_hide').setLabel('Hide VC').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('vc_unhide').setLabel('Unhide VC').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc_kick').setLabel('Kick User').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('vc_permit').setLabel('Permit User').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vc_reject').setLabel('Ban User').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('vc_limit').setLabel('Set Limit').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('vc_rename').setLabel('Rename').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vc_bitrate').setLabel('Bitrate').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('vc_stats').setLabel('VC Stats').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('vc_claim').setLabel('Claim').setStyle(ButtonStyle.Secondary)
    ),
  ];
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
    channel =
      guild.channels.cache.find((candidate) => {
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

  const message =
    `🎉 Welcome ${member} to **${guild.name}**!\n` +
    `Use \`${prefix}leaderboard\`, \`${prefix}stats\`, and \`${prefix}vcpanel\` to get started.`;
  await channel.send({ content: message });
}

function closeAfk(memberId, timestamp = Date.now()) {
  const stats = getMemberStats(memberId);
  if (!stats.afk.active || !stats.afk.since) {
    return 0;
  }

  const elapsedSeconds = Math.max(0, Math.floor((timestamp - stats.afk.since) / 1000));
  stats.afk.totalAfkSeconds += elapsedSeconds;
  stats.afk.active = false;
  stats.afk.reason = '';
  stats.afk.lastEndedAt = timestamp;
  stats.afk.since = null;
  saveState();
  return elapsedSeconds;
}

function extractTargetUserId(raw) {
  if (!raw) {
    return null;
  }

  const mentionMatch = raw.match(/^<@!?(\d+)>$/);
  if (mentionMatch) {
    return mentionMatch[1];
  }

  return /^\d+$/.test(raw) ? raw : null;
}

function getControlledVoiceChannel(member) {
  const activeChannel = member.voice?.channel;
  if (!activeChannel) {
    return { error: 'Join a voice channel first.' };
  }

  const vcMeta = tempVoiceChannels.get(activeChannel.id);
  if (!vcMeta) {
    return { error: 'This is not a managed temporary VC.' };
  }

  if (vcMeta.ownerId !== member.id) {
    return { error: 'Only the VC owner can use these controls.' };
  }

  return { channel: activeChannel, vcMeta };
}

async function createTempVoiceChannel(member, templateChannel) {
  const channelName = `${member.displayName}'s VC`;
  const newChannel = await member.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildVoice,
    parent: templateChannel.parentId || null,
    reason: `Temporary VC created for ${member.user.tag}`,
    permissionOverwrites: [
      {
        id: member.guild.roles.everyone.id,
        allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.Connect],
      },
    ],
  });

  tempVoiceChannels.set(newChannel.id, { ownerId: member.id, createdAt: Date.now() });
  await member.voice.setChannel(newChannel);
}

async function handleVcButton(interaction) {
  const { channel, vcMeta, error } = getControlledVoiceChannel(interaction.member);
  if (error) {
    await interaction.reply({ content: `❌ ${error}`, ephemeral: true });
    return;
  }

  const everyoneId = interaction.guild.roles.everyone.id;

  if (interaction.customId === 'vc_lock') {
    await channel.permissionOverwrites.edit(everyoneId, { Connect: false });
    await interaction.reply({ content: '🔒 VC locked.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_unlock') {
    await channel.permissionOverwrites.edit(everyoneId, { Connect: null });
    await interaction.reply({ content: '🔓 VC unlocked.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_hide') {
    await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false });
    await interaction.reply({ content: '🙈 VC hidden from everyone.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_unhide') {
    await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: null });
    await interaction.reply({ content: '👀 VC visible again.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_stats') {
    const statsEmbed = new EmbedBuilder()
      .setTitle('VC Stats')
      .setColor(0x00c26e)
      .addFields(
        { name: 'Owner', value: `<@${vcMeta.ownerId}>`, inline: true },
        { name: 'Members', value: `${channel.members.size}`, inline: true },
        { name: 'User Limit', value: `${channel.userLimit || 'Unlimited'}`, inline: true },
        { name: 'Bitrate', value: `${Math.floor(channel.bitrate / 1000)} kbps`, inline: true }
      );

    await interaction.reply({ embeds: [statsEmbed], ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_claim') {
    if (vcMeta.ownerId === interaction.member.id) {
      await interaction.reply({ content: '✅ You already own this VC.', ephemeral: true });
      return;
    }

    const oldOwnerStillHere = channel.members.has(vcMeta.ownerId);
    if (oldOwnerStillHere) {
      await interaction.reply({ content: '❌ Current owner is still in this VC.', ephemeral: true });
      return;
    }

    vcMeta.ownerId = interaction.member.id;
    await interaction.reply({ content: '👑 You are now the VC owner.', ephemeral: true });
    return;
  }

  const modal = new ModalBuilder();
  let input;

  if (interaction.customId === 'vc_kick') {
    modal.setCustomId('vc_modal_kick').setTitle('Kick User From VC');
    input = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('User mention or ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
  }

  if (interaction.customId === 'vc_permit') {
    modal.setCustomId('vc_modal_permit').setTitle('Permit User Into VC');
    input = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('User mention or ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
  }

  if (interaction.customId === 'vc_reject') {
    modal.setCustomId('vc_modal_reject').setTitle('Ban User From VC');
    input = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('User mention or ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
  }

  if (interaction.customId === 'vc_limit') {
    modal.setCustomId('vc_modal_limit').setTitle('Set VC User Limit');
    input = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('0 for unlimited, or 1-99')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
  }

  if (interaction.customId === 'vc_rename') {
    modal.setCustomId('vc_modal_rename').setTitle('Rename VC');
    input = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('New channel name')
      .setStyle(TextInputStyle.Short)
      .setMaxLength(100)
      .setRequired(true);
  }

  if (interaction.customId === 'vc_bitrate') {
    modal.setCustomId('vc_modal_bitrate').setTitle('Set VC Bitrate');
    input = new TextInputBuilder()
      .setCustomId('target')
      .setLabel('Bitrate in kbps (8-384)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
  }

  if (!input) {
    await interaction.reply({ content: '❌ Unsupported action.', ephemeral: true });
    return;
  }

  modal.addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

async function handleVcModal(interaction) {
  const { channel, vcMeta, error } = getControlledVoiceChannel(interaction.member);
  if (error) {
    await interaction.reply({ content: `❌ ${error}`, ephemeral: true });
    return;
  }

  const value = interaction.fields.getTextInputValue('target').trim();

  if (interaction.customId === 'vc_modal_limit') {
    const limit = Number.parseInt(value, 10);
    if (!Number.isInteger(limit) || limit < 0 || limit > 99) {
      await interaction.reply({ content: '❌ Limit must be between 0 and 99.', ephemeral: true });
      return;
    }

    await channel.setUserLimit(limit);
    await interaction.reply({ content: `👥 VC limit set to ${limit || 'unlimited'}.`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_modal_rename') {
    await channel.setName(value.slice(0, 100));
    await interaction.reply({ content: `✏️ VC renamed to **${value.slice(0, 100)}**.`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_modal_bitrate') {
    const kbps = Number.parseInt(value, 10);
    if (!Number.isInteger(kbps) || kbps < 8 || kbps > 384) {
      await interaction.reply({ content: '❌ Bitrate must be 8 to 384 kbps.', ephemeral: true });
      return;
    }

    const min = 8000;
    const max = interaction.guild.maximumBitrate || 384000;
    const targetBitrate = Math.min(max, Math.max(min, kbps * 1000));
    await channel.setBitrate(targetBitrate);
    await interaction.reply({
      content: `🔊 Bitrate set to ${Math.floor(targetBitrate / 1000)} kbps.`,
      ephemeral: true,
    });
    return;
  }

  const userId = extractTargetUserId(value);
  if (!userId) {
    await interaction.reply({ content: '❌ Provide a valid user mention or ID.', ephemeral: true });
    return;
  }

  if (userId === vcMeta.ownerId) {
    await interaction.reply({ content: '❌ You cannot target the VC owner.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!member) {
    await interaction.reply({ content: '❌ User not found in this server.', ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_modal_permit') {
    await channel.permissionOverwrites.edit(member.id, { Connect: true, ViewChannel: true });
    await interaction.reply({ content: `✅ ${member} is now permitted in your VC.`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_modal_reject') {
    await channel.permissionOverwrites.edit(member.id, { Connect: false, ViewChannel: false });
    if (member.voice.channelId === channel.id) {
      await member.voice.disconnect();
    }
    await interaction.reply({ content: `🚫 ${member} is now blocked from your VC.`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'vc_modal_kick') {
    if (member.voice.channelId !== channel.id) {
      await interaction.reply({ content: '❌ That user is not in your VC.', ephemeral: true });
      return;
    }

    await member.voice.disconnect();
    await interaction.reply({ content: `👢 ${member} was kicked from your VC.`, ephemeral: true });
  }
}

loadState();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildPresences,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  const updatePresence = () => {
    const guildCount = client.guilds.cache.size;
    const memberCount = client.guilds.cache.reduce((acc, guild) => acc + guild.memberCount, 0);
    const rotating = [
      { name: `${prefix}help`, type: ActivityType.Watching },
      { name: `${guildCount} servers`, type: ActivityType.Watching },
      { name: `${memberCount} members`, type: ActivityType.Listening },
      { name: `${prefix}vcpanel`, type: ActivityType.Playing },
    ];

    const next = rotating[Math.floor(Date.now() / 15000) % rotating.length];
    client.user.setPresence({ activities: [next], status: 'online' });
  };

  updatePresence();
  setInterval(updatePresence, 15000);
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

  const content = message.content.trim();
  const isCommand = content.startsWith(prefix);
  const commandInput = isCommand ? content.slice(prefix.length).trim() : '';
  const [command = '', ...args] = commandInput ? commandInput.split(/\s+/) : [];
  const normalized = command.toLowerCase();
  const commandBody = commandInput ? commandInput.slice(command.length).trim() : '';

  const authorStats = getMemberStats(message.author.id);
  if (authorStats.afk.active && normalized !== 'afk') {
    const elapsed = closeAfk(message.author.id);
    await message.channel.send(`✅ ${message.member} is no longer AFK. AFK duration: **${formatDuration(elapsed)}**.`);
  }

  if (message.mentions.members.size) {
    const notices = [];
    message.mentions.members.forEach((member) => {
      const stats = getMemberStats(member.id);
      if (stats.afk.active && stats.afk.since) {
        const elapsed = Math.floor((Date.now() - stats.afk.since) / 1000);
        notices.push(
          `💤 ${member.displayName} is AFK${stats.afk.reason ? ` (${stats.afk.reason})` : ''} for **${formatDuration(elapsed)}**.`
        );
      }
    });

    if (notices.length) {
      await message.channel.send(notices.join('\n'));
    }
  }

  const xpGain = 10 + Math.floor(Math.random() * 11);
  const { stats, leveledUp } = addXp(message.author.id, xpGain);
  stats.messageCount += 1;
  saveState();

  if (leveledUp) {
    await message.channel.send(`⬆️ ${message.member} reached **Level ${stats.level}**!`);
  }

  if (!isCommand || !command) {
    return;
  }

  if (normalized === 'help') {
    const helpEmbed = new EmbedBuilder()
      .setTitle('ExtraXie Commands')
      .setColor(0x5865f2)
      .setDescription(
        [
          `\`${prefix}stats [@member]\``,
          `\`${prefix}leaderboard [xp|messages|voice|afk|afktime]\``,
          `\`${prefix}afk [reason]\` / \`${prefix}afkoff\``,
          `\`${prefix}serverinfo\`, \`${prefix}roleinfo [@role|id|name]\``,
          `\`${prefix}avatar [@member]\`, \`${prefix}userinfo [@member]\``,
          `\`${prefix}embed Title | Description | #5865F2\``,
          `\`${prefix}vcpanel\` for temporary VC controls`,
          `\`${prefix}status\` for server member status counts`,
        ].join('\n')
      );

    await message.channel.send({ embeds: [helpEmbed] });
    return;
  }

  if (normalized === 'afk') {
    const afkStats = getMemberStats(message.author.id);
    if (afkStats.afk.active) {
      await message.channel.send(`💤 ${message.member}, you are already AFK.`);
      return;
    }

    afkStats.afk.active = true;
    afkStats.afk.reason = commandBody || 'No reason provided';
    afkStats.afk.since = Date.now();
    afkStats.afk.afkCount += 1;
    afkStats.afk.lastStartedAt = afkStats.afk.since;
    saveState();

    await message.channel.send(`💤 ${message.member} is now AFK${commandBody ? `: ${commandBody}` : '.'}`);
    return;
  }

  if (normalized === 'afkoff') {
    const elapsed = closeAfk(message.author.id);
    if (!elapsed) {
      await message.channel.send(`ℹ️ ${message.member}, you are not AFK right now.`);
      return;
    }

    await message.channel.send(`✅ ${message.member} AFK closed. Duration: **${formatDuration(elapsed)}**.`);
    return;
  }

  if (normalized === 'stats' || normalized === 'rank') {
    const mentioned = message.mentions.members.first();
    const targetMember = mentioned || message.member;
    const targetStats = getMemberStats(targetMember.id);

    const afkState = targetStats.afk.active && targetStats.afk.since
      ? `Active (${formatDuration((Date.now() - targetStats.afk.since) / 1000)})`
      : 'Inactive';

    await message.channel.send(
      `📊 **${targetMember.displayName}**\n` +
        `• Level: ${targetStats.level}\n` +
        `• XP: ${targetStats.xp}/${xpForNextLevel(targetStats.level)}\n` +
        `• Messages: ${targetStats.messageCount}\n` +
        `• Voice Hours: ${formatVoiceHours(targetStats.voiceSeconds)}h\n` +
        `• AFK Count: ${targetStats.afk.afkCount}\n` +
        `• Total AFK: ${formatDuration(targetStats.afk.totalAfkSeconds)}\n` +
        `• AFK Status: ${afkState}`
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
        : mode === 'afk'
        ? 'afkCount'
        : mode === 'afktime' || mode === 'afk-time' || mode === 'away'
        ? 'totalAfkSeconds'
        : 'xp';

    await message.guild.members.fetch();
    const entries = buildLeaderboardEntries(sortBy);
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

  if (normalized === 'serverinfo') {
    const serverEmbed = new EmbedBuilder()
      .setTitle(`${message.guild.name} • Server Info`)
      .setThumbnail(message.guild.iconURL({ size: 512 }))
      .setColor(0x2f3136)
      .addFields(
        { name: 'Owner', value: `<@${message.guild.ownerId}>`, inline: true },
        { name: 'Members', value: `${message.guild.memberCount}`, inline: true },
        { name: 'Roles', value: `${message.guild.roles.cache.size}`, inline: true },
        { name: 'Channels', value: `${message.guild.channels.cache.size}`, inline: true },
        { name: 'Boost Level', value: `${message.guild.premiumTier}`, inline: true },
        { name: 'Boost Count', value: `${message.guild.premiumSubscriptionCount || 0}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(message.guild.createdTimestamp / 1000)}:F>`, inline: false }
      );

    await message.channel.send({ embeds: [serverEmbed] });
    return;
  }

  if (normalized === 'roleinfo') {
    const roleMention = message.mentions.roles.first();
    const query = commandBody.trim();
    let role = roleMention;

    if (!role && query) {
      role =
        message.guild.roles.cache.get(query) ||
        message.guild.roles.cache.find((r) => r.name.toLowerCase() === query.toLowerCase()) ||
        null;
    }

    if (!role) {
      await message.channel.send(`Usage: \`${prefix}roleinfo @role\` or \`${prefix}roleinfo RoleName\`.`);
      return;
    }

    const roleEmbed = new EmbedBuilder()
      .setTitle(`Role Info • ${role.name}`)
      .setColor(role.color || 0x99aab5)
      .addFields(
        { name: 'ID', value: role.id, inline: true },
        { name: 'Members', value: `${role.members.size}`, inline: true },
        { name: 'Mentionable', value: role.mentionable ? 'Yes' : 'No', inline: true },
        { name: 'Hoisted', value: role.hoist ? 'Yes' : 'No', inline: true },
        { name: 'Position', value: `${role.position}`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(role.createdTimestamp / 1000)}:F>`, inline: false }
      );

    await message.channel.send({ embeds: [roleEmbed] });
    return;
  }

  if (normalized === 'avatar') {
    const target = message.mentions.users.first() || message.author;
    const avatarEmbed = new EmbedBuilder()
      .setTitle(`${target.username}'s Avatar`)
      .setImage(target.displayAvatarURL({ extension: 'png', size: 1024 }))
      .setColor(0x5865f2);

    await message.channel.send({ embeds: [avatarEmbed] });
    return;
  }

  if (normalized === 'userinfo') {
    const targetMember = message.mentions.members.first() || message.member;
    const targetStats = getMemberStats(targetMember.id);

    const userInfoEmbed = new EmbedBuilder()
      .setTitle(`User Info • ${targetMember.user.tag}`)
      .setThumbnail(targetMember.user.displayAvatarURL({ extension: 'png', size: 512 }))
      .setColor(0x5865f2)
      .addFields(
        { name: 'ID', value: targetMember.id, inline: true },
        { name: 'Nickname', value: targetMember.nickname || 'None', inline: true },
        { name: 'Bot', value: targetMember.user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Joined Server', value: `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:F>`, inline: false },
        { name: 'Account Created', value: `<t:${Math.floor(targetMember.user.createdTimestamp / 1000)}:F>`, inline: false },
        {
          name: 'Activity Snapshot',
          value:
            `Level ${targetStats.level} • ${targetStats.messageCount} msgs • ` +
            `${formatVoiceHours(targetStats.voiceSeconds)}h voice • ${targetStats.afk.afkCount} AFK`,
          inline: false,
        }
      );

    await message.channel.send({ embeds: [userInfoEmbed] });
    return;
  }

  if (normalized === 'status') {
    await message.guild.members.fetch();

    const counts = { online: 0, idle: 0, dnd: 0, offline: 0 };
    message.guild.members.cache.forEach((member) => {
      const status = member.presence?.status || 'offline';
      if (status === 'online') counts.online += 1;
      else if (status === 'idle') counts.idle += 1;
      else if (status === 'dnd') counts.dnd += 1;
      else counts.offline += 1;
    });

    const statusEmbed = new EmbedBuilder()
      .setTitle('Member Status Overview')
      .setColor(0x57f287)
      .setDescription(
        `🟢 Online: **${counts.online}**\n🟠 Idle: **${counts.idle}**\n🔴 DND: **${counts.dnd}**\n⚫ Offline: **${counts.offline}**`
      );

    await message.channel.send({ embeds: [statusEmbed] });
    return;
  }

  if (normalized === 'vcpanel') {
    const panelEmbed = createVcPanelEmbed(message.member);
    await message.channel.send({ embeds: [panelEmbed], components: createVcControlRows() });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('vc_')) {
    try {
      await handleVcButton(interaction);
    } catch (error) {
      console.error('VC button error:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Failed to apply VC action.', ephemeral: true });
      }
    }
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith('vc_modal_')) {
    try {
      await handleVcModal(interaction);
    } catch (error) {
      console.error('VC modal error:', error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ Failed to process VC modal input.', ephemeral: true });
      }
    }
  }
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const memberId = newState.id;
  const stats = getMemberStats(memberId);

  if (!oldState.channelId && newState.channelId) {
    stats.voiceJoinAt = Date.now();
    saveState();
  }

  if (oldState.channelId && !newState.channelId && stats.voiceJoinAt) {
    const elapsedSeconds = (Date.now() - stats.voiceJoinAt) / 1000;
    addVoiceTime(memberId, elapsedSeconds);
    stats.voiceJoinAt = null;
    saveState();
  }

  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId && stats.voiceJoinAt) {
    const elapsedSeconds = (Date.now() - stats.voiceJoinAt) / 1000;
    addVoiceTime(memberId, elapsedSeconds);
    stats.voiceJoinAt = Date.now();
    saveState();
  }

  const leftChannel = oldState.channel;
  if (leftChannel && tempVoiceChannels.has(leftChannel.id) && leftChannel.members.size === 0) {
    tempVoiceChannels.delete(leftChannel.id);
    await leftChannel.delete('Temporary VC emptied').catch(() => null);
  }

  const joinedChannel = newState.channel;
  if (!joinedChannel) {
    return;
  }

  const createVcChannel = configuredTempVcCreateChannelId
    ? newState.guild.channels.cache.get(configuredTempVcCreateChannelId)
    : newState.guild.channels.cache.find(
        (channel) => channel.type === ChannelType.GuildVoice && channel.name === tempVcCreateChannelName
      );

  if (!createVcChannel || joinedChannel.id !== createVcChannel.id) {
    return;
  }

  try {
    await createTempVoiceChannel(newState.member, createVcChannel);
  } catch (error) {
    console.error('Failed to create temporary VC:', error);
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

    if (stats.afk.active && stats.afk.since) {
      const elapsedSeconds = Math.max(0, Math.floor((now - stats.afk.since) / 1000));
      stats.afk.totalAfkSeconds += elapsedSeconds;
      stats.afk.since = now;
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
