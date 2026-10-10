# ExtraXie

ExtraXie is a Discord bot with:
- Automatic welcome messages for new server members
- Leveling + XP tracking
- Leaderboards (XP, messages, voice, AFK count, AFK time)
- Custom temporary VC system with an interactive control panel
- AFK system with AFK duration, close tracking, and AFK usage count
- Utility info commands (server info, role info, user info, avatar, status)
- Embed texting command for staff/moderation

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables:
   - `DISCORD_TOKEN` (required)
   - `COMMAND_PREFIX` (optional, default `!`)
   - `WELCOME_CHANNEL_ID` (optional)
   - `TEMP_VC_CREATE_CHANNEL_ID` (optional, recommended)
   - `TEMP_VC_CREATE_CHANNEL_NAME` (optional, default `➕ Create VC`)
3. Enable gateway intents in the Discord Developer Portal:
   - Server Members Intent
   - Message Content Intent
   - Presence Intent
4. Start the bot:
   ```bash
   npm start
   ```

## Commands

- `!help` → Show command list
- `!stats` or `!rank` → Show stats (level/xp/messages/voice/afk)
- `!stats @member` → Show another member's stats
- `!leaderboard [xp|messages|voice|afk|afktime]` → Leaderboards
- `!levelboard` / `!lvlboard` → XP level board with progress bars
- `!afk [reason]` → Mark yourself AFK
- `!afkoff` → Close AFK manually
- `!serverinfo` → Server details
- `!roleinfo @role` or `!roleinfo RoleName` → Role details
- `!avatar [@member]` → Show avatar
- `!userinfo [@member]` → Show user profile + activity snapshot
- `!status` → Show online/idle/dnd/offline counts
- `!embed Title | Description | #5865F2` → Send an embed message (Manage Messages required, color optional)
- `!vcpanel` → Send the custom VC control panel

## Custom VC system

1. Create a voice channel named `➕ Create VC` (or set `TEMP_VC_CREATE_CHANNEL_ID`).
2. When users join it, the bot creates a private temporary VC and moves them in.
3. Users can use `!vcpanel` buttons to lock/unlock/hide/unhide, rename, set limit/bitrate, permit/ban/kick users, claim ownership, and check VC stats.
4. Temporary VC channels auto-delete when empty.

## Data storage

Member activity data is saved in `data/members.json`.
