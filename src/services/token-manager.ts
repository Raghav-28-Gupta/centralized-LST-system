import { Connection, Keypair, PublicKey, sendAndConfirmRawTransaction, sendAndConfirmTransaction, SystemProgram, Transaction } from "@solana/web3.js";
import {
	TOKEN_2022_PROGRAM_ID,
	createMintToInstruction,
	createBurnInstruction,
	getAssociatedTokenAddressSync,
	createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import bs58 from "bs58";
import { config } from "../config/config";
import { logger } from "../utils/logger.ts";

export class TokenManager {
	private connection: Connection;
	private authority: Keypair;
	private lstMint: PublicKey;

	constructor(connection: Connection) {
		this.connection = connection;
		this.authority = Keypair.fromSecretKey(bs58.decode(config.authorityKeypair));
		this.lstMint = new PublicKey(config.lstMintAddress);
	}

	async mintLSTToUser(
		userPublicKey: string,
		solAmount: number
	): Promise<string> {
		try {
			const user = new PublicKey(userPublicKey);

			// Calculate LST amount based on exchange rate
			const lstAmount = Math.floor(solAmount * config.exchangeRate);

			logger.info(`Minting ${lstAmount / 1e9} lstSOL to ${userPublicKey}`);

			// Get or create user's ATA
			const userATA = getAssociatedTokenAddressSync(
				this.lstMint,
				user,
				false,
				TOKEN_2022_PROGRAM_ID
			);

			const transaction = new Transaction();

			// Check if ATA exists
			const ataInfo = await this.connection.getAccountInfo(userATA);
			if (!ataInfo) {
				// Create ATA if it doesn't exist
				transaction.add(
					createAssociatedTokenAccountInstruction(
						this.authority.publicKey,
						userATA,
						user,
						this.lstMint,
						TOKEN_2022_PROGRAM_ID
					)
				);
			}

			// Mint tokens to user
			transaction.add(
				createMintToInstruction(
					this.lstMint,
					userATA,
					this.authority.publicKey,
					lstAmount,
					[],
					TOKEN_2022_PROGRAM_ID
				)
			);
               
			const signature = await sendAndConfirmTransaction(this.connection, transaction, [this.authority]);  

			logger.info(
				`✅ Minted ${lstAmount / 1e9} lstSOL. Signature: ${signature}`
			);

			return signature;
		} catch (error) {
			logger.error("Error minting LST:", error);
			throw error;
		}
	}

	async burnLSTAndReturnSOL(
		userPublicKey: string,
		lstAmount: number
	): Promise<string> {
		try {
			const user = new PublicKey(userPublicKey);

			// Calculate SOL to return (including yield)
			const solToReturn = await this.calculateSOLReturn(lstAmount);

			logger.info(
				`Burning ${lstAmount / 1e9} lstSOL, returning ${
					solToReturn / 1e9
				} SOL`
			);

			const userATA = getAssociatedTokenAddressSync(
				this.lstMint,
				user,
				false,
				TOKEN_2022_PROGRAM_ID
			);

			const transaction = new Transaction();

			// Burn LST tokens
			transaction.add(
				createBurnInstruction(
					userATA,
					this.lstMint,
					user,
					lstAmount,
					[],
					TOKEN_2022_PROGRAM_ID
				)
			);

			// Transfer SOL back to user
			transaction.add(
				SystemProgram.transfer({
					fromPubkey: this.authority.publicKey,
					toPubkey: user,
					lamports: solToReturn,
				})
			);

			const signature = await this.connection.sendTransaction(
				transaction,
				[this.authority]
			);
			await this.connection.confirmTransaction(signature, "confirmed");

			logger.info(
				`✅ Burned lstSOL and returned SOL. Signature: ${signature}`
			);

			return signature;
		} catch (error) {
			logger.error("Error burning LST:", error);
			throw error;
		}
	}

	private async calculateSOLReturn(lstAmount: number): Promise<number> {
		// Simple yield calculation (in production, use actual staking rewards)
		const baseSOL = lstAmount / config.exchangeRate;
		const yieldMultiplier = 1 + config.yieldAPY * (365 / 365); // 1 year
		return Math.floor(baseSOL * yieldMultiplier);
	}
}
