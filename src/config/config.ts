export const config = {
	// Helius
	heliusApiKey: process.env.HELIUS_API_KEY || "",
	heliusWebsocketUrl: `wss://devnet.helius-rpc.com?api-key=${process.env.HELIUS_API_KEY}`,

	// Solana
	rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",

	// Your addresses
	depositAddress: process.env.DEPOSIT_ADDRESS || "", // The address users send SOL to
	lstMintAddress: process.env.LST_MINT_ADDRESS || "", // Your LST token mint
	authorityKeypair: process.env.AUTHORITY_PRIVATE_KEY || "",

	// LST Parameters
	exchangeRate: 1.0, // 1 SOL = 1 lstSOL initially
	yieldAPY: 0.05, // 5% APY

	// Database
	mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/lst-system",
};
