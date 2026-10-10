# ExtraXie

ExtraXie is a Discord bot with:
- Automatic welcome messages for new server members
- A leveling system based on activity
- Leaderboards for XP, message count, and voice hours
- Member stats command (level, XP, messages, voice time)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Set environment variables:
   - `DISCORD_TOKEN` (required)
   - `COMMAND_PREFIX` (optional, default `!`)
   - `WELCOME_CHANNEL_ID` (optional, uses system channel if not provided)
3. Start the bot:
   ```bash
   npm start
   ```

## Commands

- `!stats` or `!rank` → Show your stats
- `!stats @member` → Show another member's stats
- `!leaderboard` or `!lb` → XP leaderboard
- `!leaderboard messages` → Message leaderboard
- `!leaderboard voice` → Voice-hours leaderboard

## Data storage

Member activity data is saved in `data/members.json`.
