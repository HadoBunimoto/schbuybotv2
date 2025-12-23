import axios from 'axios';

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // DexHunter API
  DEXHUNTER_API_URL: 'https://api-us.dexhunterv3.app',
  DEXHUNTER_PARTNER_ID: process.env.DEXHUNTER_PARTNER_ID || 'snekcash61646472317138797671387a377634716c6572616b657a307465396b336e6c6137356a7666736a387a6465726c373276663963393972717275737938653261707737756173687a61677a6b7170613567787373353375303779677439367773387376747a33676dda39a3ee5e6b4b0d3255bfef95601890afd80709',
  
  // Discord
  DISCORD_WEBHOOK_URL: process.env.DISCORD_WEBHOOK_URL || 'https://discord.com/api/webhooks/1453131545530335466/I-4_AiGzaNtnqvctzmxwVsqShgypuu2Ksa2z1RojgJmlkPbZGXdpL3BB9crd6WK8YRMc',
  
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
  // Additional fields that might be in the response
  input_amount?: number;
  output_amount?: number;
  token_in?: string;
  token_out?: string;
  // DexHunter API may also use these field names
  total_input?: number;
  total_output?: number;
  amount_token_in?: number;
  amount_token_out?: number;
  lovelace_in?: number;
  lovelace_out?: number;
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
  // Debug log to see actual order structure
  console.log('Order data:', JSON.stringify(order, null, 2));
  
  // Try multiple possible field names for amounts based on DexHunter API
  // The API may use total_input/total_output from swap responses
  const rawAmountIn = order.amount_in || order.input_amount || order.total_input || order.amount_token_in || order.lovelace_in || 0;
  const rawAmountOut = order.actual_out_amount || order.expected_out_amount || order.output_amount || order.total_output || order.amount_token_out || 0;
  
  console.log(`Raw amounts - In: ${rawAmountIn}, Out: ${rawAmountOut}, Pair: ${pairType}`);
  
  // Calculate amounts based on pair type
  let amountSpent: number;
  let spentLabel: string;
  
  if (pairType === 'ADA') {
    amountSpent = rawAmountIn / Math.pow(10, CONFIG.ADA_DECIMALS);
    spentLabel = 'ADA Amount';
  } else {
    // For NIGHT buys, convert NIGHT to ADA equivalent for display
    const nightAmount = rawAmountIn / Math.pow(10, CONFIG.NIGHT_DECIMALS);
    // Show NIGHT amount but also calculate ADA equivalent if needed
    amountSpent = nightAmount;
    spentLabel = 'NIGHT Amount';
  }
  
  const schReceived = rawAmountOut / Math.pow(10, CONFIG.SCH_DECIMALS);
  
  // If amounts are still 0, try to estimate from SCH received and price
  let displayAmount = amountSpent;
  if (displayAmount === 0 && schReceived > 0 && schPriceInAda > 0) {
    // Estimate ADA spent based on SCH received and price
    displayAmount = schReceived * schPriceInAda;
    spentLabel = 'ADA Amount (est.)';
  }
  
  // Calculate market cap (SCH supply * price in ADA)
  const SCH_SUPPLY = 1_000_000_000; // 1 billion SCH
  const marketCapAda = SCH_SUPPLY * schPriceInAda;
  
  // Cyan-green color matching the logo
  const color = 0x3EEBBE;
  
  // Build description with bold title at top
  const descriptionLines = [
    `**New Snek Cash Buy Detected**`,
    ``,
    `**${spentLabel}:** ${displayAmount.toFixed(2)} ₳`,
    `**Snek Cash Amount:** ${formatNumberWithCommas(schReceived)} $SCH`,
    `**Token Price:** ${schPriceInAda > 0 ? schPriceInAda.toFixed(8) : 'N/A'} ₳`,
    `**Market Cap:** ${marketCapAda > 0 ? formatNumberWithCommas(Math.round(marketCapAda)) : 'N/A'} ₳`,
    ``,
    `[🔍 View TX](https://cardanoscan.io/transaction/${order.tx_hash})`,
  ];
  
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
    
    // Collect all new orders to process (avoid duplicates)
    const newOrders: { order: DexHunterOrder; pairType: 'ADA' | 'NIGHT' }[] = [];
    
    // Process ADA buys
    for (const order of adaBuys) {
      if (!seenTransactions.has(order.tx_hash)) {
        seenTransactions.add(order.tx_hash);
        if (!isFirstRun) {
          newOrders.push({ order, pairType: 'ADA' });
        }
      }
    }
    
    // Process NIGHT buys
    for (const order of nightBuys) {
      if (!seenTransactions.has(order.tx_hash)) {
        seenTransactions.add(order.tx_hash);
        if (!isFirstRun) {
          newOrders.push({ order, pairType: 'NIGHT' });
        }
      }
    }
    
    // Send notifications for new orders (one at a time to avoid duplicates)
    for (const { order, pairType } of newOrders) {
      console.log(`🆕 New ${pairType} buy: ${order.tx_hash}`);
      const embed = await createBuyEmbed(order, pairType, adaPrice, schPriceInAda);
      await sendDiscordNotification(embed);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
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
    color: 0x3EEBBE,
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

