import axios from 'axios';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // DexHunter API
  DEXHUNTER_API_URL: 'https://api-us.dexhunterv3.app',
  DEXHUNTER_PARTNER_ID: process.env.DEXHUNTER_PARTNER_ID || 'snekcash61646472317138797671387a377634716c6572616b657a307465396b336e6c6137356a7666736a387a6465726c373276663963393972717275737938653261707737756173687a61677a6b7170613567787373353375303779677439367773387376747a33676dda39a3ee5e6b4b0d3255bfef95601890afd80709',
  
  // Discord
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1451969354961785044/CnK5m9H4sAxrPWyxjHcjC80mQtuVqVnALXQlpczU9EJhss5eHF_HrwXb7XrFVc43bXdZ',
  
  // Token IDs
  SCH_TOKEN_ID: '7ad3a27163e497f42d52890e78007d7562899a899e39e5f4dcb1589a536e656b2043617368',
  NIGHT_TOKEN_ID: '0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854',
  ADA_TOKEN_ID: '', // ADA is represented by empty string
  
  // Polling interval (in ms) - 15 seconds
  POLL_INTERVAL: 15000,
  
  // Token decimals
  SCH_DECIMALS: 0,
  ADA_DECIMALS: 6,
  NIGHT_DECIMALS: 6,
};

// ============================================
// TYPES
// ============================================
interface DexHunterOrder {
  _id: string;
  tx_hash: string;
  status: string;
  amount_in: number;
  expected_out_amount: number;
  actual_out_amount?: number;
  submission_time: string;
  completion_time?: string;
  token_id_in: string;
  token_id_out: string;
  sender_address?: string;
  dex_name?: string;
}

interface OrdersResponse {
  orders: DexHunterOrder[];
  total?: number;
}

interface TokenPrice {
  price_ba: number;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  thumbnail?: { url: string };
  image?: { url: string };
  footer?: { text: string; icon_url?: string };
  timestamp?: string;
}

// ============================================
// STATE
// ============================================
const seenTransactions = new Set<string>();
let isFirstRun = true;

// ============================================
// API HELPERS
// ============================================
const dexhunterApi = axios.create({
  baseURL: CONFIG.DEXHUNTER_API_URL,
  headers: {
    'X-Partner-Id': CONFIG.DEXHUNTER_PARTNER_ID,
    'Content-Type': 'application/json',
  },
});

async function getAdaPrice(): Promise<number> {
  try {
    const response = await dexhunterApi.get('/swap/adaValue');
    return response.data;
  } catch (error) {
    console.error('Failed to get ADA price:', error);
    return 0;
  }
}

async function getTokenPriceInAda(tokenId: string): Promise<number> {
  try {
    const response = await dexhunterApi.get<TokenPrice>(`/swap/averagePrice/ADA/${tokenId}`);
    return response.data.price_ba;
  } catch (error) {
    console.error(`Failed to get token price for ${tokenId}:`, error);
    return 0;
  }
}

async function getCompletedBuys(tokenId1: string, tokenId2: string): Promise<DexHunterOrder[]> {
  try {
    const response = await dexhunterApi.post<OrdersResponse>('/swap/ordersByPair', {
      page: 0,
      perPage: 50,
      tokenId1: tokenId1,
      tokenId2: tokenId2,
      filters: [
        { filterType: 'STATUS', values: ['COMPLETE'] },
      ],
      orderSorts: 'STARTTIME',
      sortDirection: 'DESC',
    });
    
    // Filter for buys only (where token_id_out is SCH)
    const orders = response.data.orders || response.data || [];
    return Array.isArray(orders) ? orders.filter(order => 
      order.token_id_out === CONFIG.SCH_TOKEN_ID
    ) : [];
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return [];
  }
}

// ============================================
// DISCORD NOTIFICATION
// ============================================
async function sendDiscordNotification(embed: DiscordEmbed): Promise<void> {
  try {
    await axios.post(CONFIG.DISCORD_WEBHOOK_URL, {
      embeds: [embed],
    });
    console.log('✅ Discord notification sent');
  } catch (error) {
    console.error('Failed to send Discord notification:', error);
  }
}

function formatNumber(num: number, decimals: number = 2): string {
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(decimals) + 'M';
  } else if (num >= 1_000) {
    return (num / 1_000).toFixed(decimals) + 'K';
  }
  return num.toFixed(decimals);
}

function truncateAddress(address: string): string {
  if (!address || address.length < 20) return address || 'Unknown';
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

async function createBuyEmbed(
  order: DexHunterOrder,
  pairType: 'ADA' | 'NIGHT',
  adaPrice: number,
  schPriceInAda: number
): Promise<DiscordEmbed> {
  const amountIn = pairType === 'ADA' 
    ? order.amount_in / Math.pow(10, CONFIG.ADA_DECIMALS)
    : order.amount_in / Math.pow(10, CONFIG.NIGHT_DECIMALS);
  
  const schReceived = (order.actual_out_amount || order.expected_out_amount) / Math.pow(10, CONFIG.SCH_DECIMALS);
  
  // Calculate USD values
  const spentUsd = pairType === 'ADA' 
    ? amountIn * adaPrice
    : amountIn * (await getTokenPriceInAda(CONFIG.NIGHT_TOKEN_ID)) * adaPrice;
  
  // Green color matching the screenshot
  const color = 0x2ecc71;
  
  // Build description with all the info (matching screenshot layout)
  const descriptionLines = [
    `**💵 Spent:** ${formatNumber(amountIn, 2)} ${pairType} ($${formatNumber(spentUsd, 2)} USD)`,
    `**🪙 Received:** ${formatNumberWithCommas(schReceived)} $SCH`,
    `**📊 Price:** ${schPriceInAda.toFixed(6)} ADA ($${(schPriceInAda * adaPrice).toFixed(6)})`,
  ];
  
  // Add DEX if available
  if (order.dex_name) {
    descriptionLines.push(`**🏦 DEX:** ${order.dex_name}`);
  }
  
  // Add transaction link
  descriptionLines.push(`**🔗 Transaction:** [View on CardanoScan](https://cardanoscan.io/transaction/${order.tx_hash})`);
  
  // Add buyer if available
  if (order.sender_address) {
    descriptionLines.push(`**👤 Buyer:** \`${truncateAddress(order.sender_address)}\``);
  }
  
  const embed: DiscordEmbed = {
    color: color,
    description: descriptionLines.join('\n'),
    image: {
      url: 'https://raw.githubusercontent.com/HadoBunimoto/schbuybotv2/main/banner.png',
    },
    footer: {
      text: 'Powered by scream2',
    },
  };
  
  return embed;
}

function formatNumberWithCommas(num: number): string {
  return Math.round(num).toLocaleString('en-US');
}

// ============================================
// MAIN POLLING LOGIC
// ============================================
async function checkForNewBuys(): Promise<void> {
  console.log(`\n[${new Date().toISOString()}] Checking for new $SCH buys...`);
  
  try {
    // Get current prices
    const [adaPrice, schPriceInAda] = await Promise.all([
      getAdaPrice(),
      getTokenPriceInAda(CONFIG.SCH_TOKEN_ID),
    ]);
    
    console.log(`ADA Price: $${adaPrice.toFixed(4)} | SCH Price: ${schPriceInAda} ADA ($${(schPriceInAda * adaPrice).toFixed(8)})`);
    
    // Fetch buys from both pairs
    const [adaBuys, nightBuys] = await Promise.all([
      getCompletedBuys(CONFIG.ADA_TOKEN_ID, CONFIG.SCH_TOKEN_ID),
      getCompletedBuys(CONFIG.NIGHT_TOKEN_ID, CONFIG.SCH_TOKEN_ID),
    ]);
    
    console.log(`Found ${adaBuys.length} ADA buys, ${nightBuys.length} NIGHT buys`);
    
    // Process ADA buys
    for (const order of adaBuys) {
      if (!seenTransactions.has(order.tx_hash)) {
        seenTransactions.add(order.tx_hash);
        
        if (!isFirstRun) {
          console.log(`🆕 New ADA buy: ${order.tx_hash}`);
          const embed = await createBuyEmbed(order, 'ADA', adaPrice, schPriceInAda);
          await sendDiscordNotification(embed);
        }
      }
    }
    
    // Process NIGHT buys
    for (const order of nightBuys) {
      if (!seenTransactions.has(order.tx_hash)) {
        seenTransactions.add(order.tx_hash);
        
        if (!isFirstRun) {
          console.log(`🆕 New NIGHT buy: ${order.tx_hash}`);
          const embed = await createBuyEmbed(order, 'NIGHT', adaPrice, schPriceInAda);
          await sendDiscordNotification(embed);
        }
      }
    }
    
    // After first run, we'll start notifying
    if (isFirstRun) {
      console.log(`✅ Initial sync complete. Tracking ${seenTransactions.size} existing transactions.`);
      isFirstRun = false;
    }
    
    // Cleanup old transactions (keep last 1000)
    if (seenTransactions.size > 1000) {
      const arr = Array.from(seenTransactions);
      const toRemove = arr.slice(0, arr.length - 1000);
      toRemove.forEach(tx => seenTransactions.delete(tx));
      console.log(`🧹 Cleaned up ${toRemove.length} old transaction records`);
    }
    
  } catch (error) {
    console.error('Error in checkForNewBuys:', error);
  }
}

// ============================================
// STARTUP
// ============================================
async function sendStartupMessage(): Promise<void> {
  const embed: DiscordEmbed = {
    description: [
      '🐍 **Snek Cash Buy Bot Started!**',
      '',
      'Now monitoring for $SCH buys:',
      '• ADA → SCH swaps',
      '• NIGHT → SCH swaps',
      '',
      `Poll Interval: ${CONFIG.POLL_INTERVAL / 1000} seconds`,
    ].join('\n'),
    color: 0x2ecc71,
    image: {
      url: 'https://raw.githubusercontent.com/HadoBunimoto/schbuybotv2/main/banner.png',
    },
    footer: {
      text: 'Powered by scream2',
    },
  };
  
  await sendDiscordNotification(embed);
}

async function main(): Promise<void> {
  console.log('🐍 Starting Snek Cash Buy Bot...');
  console.log(`Config:
  - DexHunter API: ${CONFIG.DEXHUNTER_API_URL}
  - SCH Token: ${CONFIG.SCH_TOKEN_ID}
  - Poll Interval: ${CONFIG.POLL_INTERVAL}ms
  `);
  
  // Send startup notification
  await sendStartupMessage();
  
  // Initial check to populate seen transactions
  await checkForNewBuys();
  
  // Start polling
  setInterval(checkForNewBuys, CONFIG.POLL_INTERVAL);
  
  console.log('✅ Bot is running! Press Ctrl+C to stop.');
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down...');
  process.exit(0);
});

// Start the bot
main().catch(console.error);

