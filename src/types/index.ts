export interface DepositTransaction {
	signature: string;
	userPublicKey: string;
	amount: number; // in lamports
	timestamp: number;
}

export interface WithdrawalTransaction {
	signature: string;
	userPublicKey: string;
	lstAmount: number; // in smallest unit
	timestamp: number;
}

export interface UserPosition {
	userPublicKey: string;
	solDeposited: number;
	lstTokensReceived: number;
	depositTimestamp: number;
	yieldAccrued: number;
}
