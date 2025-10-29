import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	SystemProgram,
	Transaction,
	PublicKey,
	sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { config } from "../config/config";

async function testDeposit() {
	try {
		// Connect to configured RPC (devnet)
		const connection = new Connection(config.rpcUrl, "confirmed");
		console.log("Connected to Solana RPC:", config.rpcUrl);

		// Load test user from environment
		const testUserPrivateKey = process.env.TEST_USER_PRIVATE_KEY;
		if (!testUserPrivateKey) {
			throw new Error("TEST_USER_PRIVATE_KEY not found in .env");
		}

		const testUser = Keypair.fromSecretKey(bs58.decode(testUserPrivateKey));
		console.log("\n Test User Public Key:", testUser.publicKey.toString());

		// Check test user balance
		const balance = await connection.getBalance(testUser.publicKey);
		console.log(`Test User Balance: ${balance / LAMPORTS_PER_SOL} SOL`);

		if (balance < 0.1 * LAMPORTS_PER_SOL) {
               throw new Error("Insufficient balance. Please fund your test user account.");
          }

		// Use deposit address from config
		if (!config.depositAddress) {
			throw new Error("DEPOSIT_ADDRESS not configured in .env");
		}

		const depositAddress = new PublicKey(config.depositAddress);
		console.log("\n Deposit Address:", depositAddress.toString());

		// Check deposit address balance before
		const depositBalanceBefore = await connection.getBalance(depositAddress);
		console.log(`Deposit Address Balance (before): ${depositBalanceBefore / LAMPORTS_PER_SOL} SOL`);

		// Amount to deposit
		const amountToSend = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL
		console.log(`\n Sending ${amountToSend / LAMPORTS_PER_SOL} SOL to deposit address...`);

		// Create and send transaction
		const transaction = new Transaction().add(
			SystemProgram.transfer({
				fromPubkey: testUser.publicKey,
				toPubkey: depositAddress,
				lamports: amountToSend,
			})
		);

		const signature = await sendAndConfirmTransaction(
			connection,
			transaction,
			[testUser],
			{
				commitment: "confirmed",
			}
		);

		console.log("Deposit transaction sent and confirmed!");
		console.log("Transaction Signature:", signature);
		console.log(`View on Solana Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);

		// Check balances after
		await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s for balance update

		const testUserBalanceAfter = await connection.getBalance(testUser.publicKey);
		const depositBalanceAfter = await connection.getBalance(depositAddress);

		console.log("\n Final Balances:");
		console.log(`   Test User: ${testUserBalanceAfter / LAMPORTS_PER_SOL} SOL`);
		console.log(`   Deposit Address: ${depositBalanceAfter / LAMPORTS_PER_SOL} SOL`);

		console.log("\n Test complete!");
		console.log("Now check your backend logs to see if the deposit was detected!");
		console.log(
			`   Expected log: "💰 Deposit detected: 0.1 SOL from ${testUser.publicKey
				.toString()
				.slice(0, 8)}..."`
		);
		console.log("\n💡 Tips:");
		console.log("   1. Make sure your backend is running (npm run dev)");
		console.log("   2. Check that Helius WebSocket is connected");
		console.log("   3. Verify LST tokens minted to test user's ATA");
	} catch (error) {
		console.error("\n❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testDeposit();
