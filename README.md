# 🐍 Snek Cash ($SCH) Discord Buy Bot

A Discord bot that monitors and announces $SCH token purchases on Cardano DEXes via DexHunter.

## Features

- 📊 Monitors both ADA → SCH and NIGHT → SCH swaps
- 💰 Displays buy amount in native token and USD
- 🔗 Links to transaction on CardanoScan
- 🎨 Color-coded embeds based on buy size
- ⏱️ Real-time polling (15 second intervals)

## Quick Deploy to Railway

### 1. Prerequisites
- A [Railway](https://railway.app) account
- Git installed on your machine

### 2. Deploy Steps

1. **Push to GitHub** (or use Railway's direct deploy):
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Create a new project on Railway**:
   - Go to [railway.app](https://railway.app)
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository

3. **Add Environment Variables**:
   In Railway dashboard, go to your service → Variables → Add the following:
   
   | Variable | Value |
   |----------|-------|
   | `DEXHUNTER_PARTNER_ID` | Your DexHunter Partner API key |
   | `DISCORD_WEBHOOK_URL` | Your Discord webhook URL |

4. **Deploy**:
   Railway will automatically build and deploy. The bot will start monitoring for buys!

## Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Create environment file
Create a `.env` file in the root directory:
```
DEXHUNTER_PARTNER_ID=your_api_key_here
DISCORD_WEBHOOK_URL=your_webhook_url_here
```

### 3. Run in development mode
```bash
npm run dev
```

### 4. Build and run production
```bash
npm run build
npm start
```

## Configuration

The bot can be configured by editing `src/index.ts`:

| Config | Default | Description |
|--------|---------|-------------|
| `POLL_INTERVAL` | 15000 | Polling interval in milliseconds |
| `SCH_TOKEN_ID` | `7ad3a...` | SCH token ID on Cardano |
| `NIGHT_TOKEN_ID` | `0691b...` | NIGHT token ID for NIGHT/SCH pair |

## API Reference

This bot uses the [DexHunter Partner API](https://dexhunter.gitbook.io/dexhunter-partners/):
- `POST /swap/ordersByPair` - Fetch completed orders for token pairs
- `GET /swap/averagePrice/ADA/{token}` - Get token price in ADA
- `GET /swap/adaValue` - Get ADA/USD price

## Discord Embed Preview

The bot sends embeds like this:

```
🐍💰 New $SCH Buy!

💵 Spent          🪙 Received       📊 Price
100 ADA           50,000 $SCH       0.002 ADA
($45.00 USD)                        ($0.0009 USD)

🏦 DEX            🔗 Transaction
MINSWAP           View on CardanoScan

👤 Buyer
addr1qx2...n8q4
```

## Troubleshooting

### Bot not sending notifications?
1. Check Railway logs for errors
2. Verify environment variables are set correctly
3. Ensure the Discord webhook URL is valid

### Getting rate limited?
Increase the `POLL_INTERVAL` value (default: 15000ms)

## License

MIT

