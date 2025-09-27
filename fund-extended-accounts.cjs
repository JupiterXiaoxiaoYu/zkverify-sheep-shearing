const { zkVerifySession } = require("zkverifyjs");
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady } = require('@polkadot/util-crypto');
const dotenv = require('dotenv');

dotenv.config();

class ExtendedAccountFunder {
    constructor() {
        this.session = null;
        this.accountSeed = process.env.SEED_PHRASE;
        this.derivedAccounts = [];
        this.accountCount = 20; // Total accounts needed to access 9-20
        this.startIndex = 8; // Start from account 9 (index 8)
        this.fundAmount = "250000000000000000000"; // 250 tokens in wei (18 decimals)
    }

    async initializeSession() {
        try {
            console.log('🚀 Initializing funding session...');
            
            // Wait for crypto to be ready
            await cryptoWaitReady();
            
            // Validate seed phrase
            if (!this.accountSeed) {
                throw new Error('SEED_PHRASE environment variable is not set.');
            }
            
            console.log(`🔑 Using seed phrase starting with: ${this.accountSeed.split(' ')[0]}...`);
            
            // Initialize session with base account
            this.session = await zkVerifySession.start().Volta().withAccount(this.accountSeed);
            
            // Get base account info
            const accountInfo = await this.session.getAccountInfo();
            const baseAddress = accountInfo[0].address;
            const baseBalance = accountInfo[0].freeBalance; // Use freeBalance instead of balance
            
            console.log(`📍 Main account: ${baseAddress}`);
            console.log(`🔍 Raw balance data:`, accountInfo[0]);
            
            // Handle balance parsing more safely
            let balanceValue = "0";
            if (baseBalance !== undefined && baseBalance !== null) {
                if (typeof baseBalance === 'string') {
                    balanceValue = baseBalance;
                } else if (typeof baseBalance === 'object' && baseBalance.toString) {
                    balanceValue = baseBalance.toString();
                } else {
                    balanceValue = String(baseBalance);
                }
            }
            
            console.log(`💰 Main account balance: ${(Number(BigInt(balanceValue)) / 1e18).toFixed(3)} tokens`);
            
            // Check if main account has enough funds
            const totalNeeded = BigInt(this.fundAmount) * BigInt(12); // 12 accounts * 250 tokens each
            const gasCostEstimate = BigInt("1000000000000000000"); // Estimate 1 token for gas
            const totalRequired = totalNeeded + gasCostEstimate;
            
            console.log(`💸 Total funding needed: ${(Number(totalNeeded) / 1e18).toFixed(0)} tokens`);
            console.log(`⛽ Estimated gas cost: ${(Number(gasCostEstimate) / 1e18).toFixed(3)} tokens`);
            console.log(`📊 Total required: ${(Number(totalRequired) / 1e18).toFixed(3)} tokens`);
            
            // Safely convert balance to BigInt
            let balanceBigInt;
            try {
                balanceBigInt = BigInt(balanceValue);
            } catch (error) {
                console.error(`❌ Cannot parse balance as BigInt: ${balanceValue}`);
                return false;
            }
            
            if (balanceBigInt < totalRequired) {
                console.error(`❌ Insufficient funds! Available: ${(Number(balanceBigInt) / 1e18).toFixed(3)}, Required: ${(Number(totalRequired) / 1e18).toFixed(3)}`);
                return false;
            }
            
            // Derive all accounts to access the extended range
            console.log(`🔄 Deriving ${this.accountCount - 1} accounts to access extended accounts...`);
            const allDerivedAddresses = await this.session.addDerivedAccounts(baseAddress, this.accountCount - 1);
            
            // Store all accounts and extract the ones we need (indices 8-19 = accounts 9-20)
            const allAccounts = [baseAddress, ...allDerivedAddresses];
            this.derivedAccounts = allAccounts.slice(this.startIndex, this.accountCount);
            
            console.log(`✅ Found ${this.derivedAccounts.length} extended accounts to fund (accounts 9-20):`);
            this.derivedAccounts.forEach((address, index) => {
                const actualAccountNumber = this.startIndex + index + 1;
                console.log(`   Account ${actualAccountNumber}: ${address}`);
            });
            
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize funding session:', error.message);
            return false;
        }
    }

    async checkAccountBalances() {
        console.log('\n🔍 Checking current balances of extended accounts...');
        
        const balances = [];
        for (let i = 0; i < this.derivedAccounts.length; i++) {
            const address = this.derivedAccounts[i];
            const actualAccountNumber = this.startIndex + i + 1;
            
            try {
                // Get account info for each derived account
                const accountInfo = await this.session.getAccountInfo(address);
                const balance = accountInfo[0].freeBalance; // Use freeBalance instead of balance
                
                // Handle balance parsing safely
                let balanceValue = "0";
                if (balance !== undefined && balance !== null) {
                    if (typeof balance === 'string') {
                        balanceValue = balance;
                    } else if (typeof balance === 'object' && balance.toString) {
                        balanceValue = balance.toString();
                    } else {
                        balanceValue = String(balance);
                    }
                }
                
                const balanceInTokens = (Number(BigInt(balanceValue)) / 1e18).toFixed(3);
                
                balances.push({
                    accountNumber: actualAccountNumber,
                    address: address,
                    balance: balanceValue,
                    balanceInTokens: balanceInTokens
                });
                
                console.log(`   Account ${actualAccountNumber} (${address.slice(0, 8)}...): ${balanceInTokens} tokens`);
            } catch (error) {
                console.error(`   ❌ Failed to get balance for account ${actualAccountNumber}: ${error.message}`);
                balances.push({
                    accountNumber: actualAccountNumber,
                    address: address,
                    balance: "0",
                    balanceInTokens: "0.000",
                    error: error.message
                });
            }
        }
        
        return balances;
    }

    async fundAccount(targetAddress, accountNumber, amount, api, sender) {
        const maxRetries = 3;
        let retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                console.log(`💸 Funding account ${accountNumber} (${targetAddress.slice(0, 8)}...) with ${(Number(amount) / 1e18).toFixed(0)} tokens...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
                
                // Create transfer transaction using Polkadot API
                const transfer = api.tx.balances.transferAllowDeath(targetAddress, amount);
                
                // Sign and send
                const hash = await transfer.signAndSend(sender);
                console.log(`✅ Successfully funded account ${accountNumber}! Transaction hash: ${hash.toHex()}`);
                
                // Wait for transaction to be processed
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                return true;
                
            } catch (error) {
                retryCount++;
                let errorMessage = error?.message || JSON.stringify(error) || error.toString();
                
                console.error(`❌ Error funding account ${accountNumber} (attempt ${retryCount}):`, errorMessage);
                
                // Check for specific errors that should trigger retry
                const shouldRetry = 
                    errorMessage.includes('Priority is too low') ||
                    errorMessage.includes('already in the pool') ||
                    errorMessage.includes('disconnected') ||
                    errorMessage.includes('Abnormal Closure') ||
                    errorMessage.includes('Connection') ||
                    errorMessage.includes('timeout') ||
                    errorMessage.includes('nonce');
                
                if (shouldRetry && retryCount < maxRetries) {
                    const retryDelay = errorMessage.includes('Priority is too low') ? 3000 : 5000;
                    const delayText = errorMessage.includes('Priority is too low') ? '3 seconds' : '5 seconds';
                    console.log(`⏳ Waiting ${delayText} before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    if (retryCount >= maxRetries) {
                        console.error(`❌ Max retries (${maxRetries}) reached for account ${accountNumber}`);
                    }
                    return false;
                }
            }
        }
        
        return false;
    }

    async fundAllAccounts() {
        console.log('\n🚀 Starting funding process for all extended accounts...');
        
        // Connect to zkVerify API
        const provider = new WsProvider('wss://testnet-rpc.zkverify.io');
        const api = await ApiPromise.create({ provider });
        
        // Create keyring and add sender account
        const keyring = new Keyring({ type: 'sr25519' });
        const sender = keyring.addFromMnemonic(this.accountSeed);
        
        console.log(`🔑 Sender account: ${sender.address}`);
        
        const results = [];
        let successCount = 0;
        let failCount = 0;
        
        // Fund accounts sequentially to avoid nonce conflicts
        for (let i = 0; i < this.derivedAccounts.length; i++) {
            const address = this.derivedAccounts[i];
            const actualAccountNumber = this.startIndex + i + 1;
            
            console.log(`\n📤 [${i + 1}/${this.derivedAccounts.length}] Processing account ${actualAccountNumber}...`);
            
            const success = await this.fundAccount(address, actualAccountNumber, this.fundAmount, api, sender);
            
            results.push({
                accountNumber: actualAccountNumber,
                address: address,
                success: success,
                amount: this.fundAmount
            });
            
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            
            // Small delay between transactions to avoid overwhelming the network
            if (i < this.derivedAccounts.length - 1) {
                console.log('⏳ Waiting 2 seconds before next transaction...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        // Cleanup API connection
        await api.disconnect();
        
        // Print summary
        console.log('\n📊 Funding Summary:');
        console.log(`   ✅ Successfully funded: ${successCount}/${this.derivedAccounts.length} accounts`);
        console.log(`   ❌ Failed to fund: ${failCount}/${this.derivedAccounts.length} accounts`);
        console.log(`   💰 Total amount distributed: ${(successCount * 250).toFixed(0)} tokens`);
        
        // Print detailed results
        console.log('\n📋 Detailed Results:');
        results.forEach(result => {
            const status = result.success ? '✅' : '❌';
            const amount = (Number(result.amount) / 1e18).toFixed(0);
            console.log(`   ${status} Account ${result.accountNumber} (${result.address.slice(0, 8)}...): ${amount} tokens`);
        });
        
        return results;
    }

    async checkFinalBalances() {
        console.log('\n🔍 Checking final balances after funding...');
        await this.checkAccountBalances();
    }

    async run() {
        try {
            // Initialize session
            if (!await this.initializeSession()) {
                console.error('❌ Failed to initialize session. Exiting.');
                process.exit(1);
            }
            
            // Check current balances
            await this.checkAccountBalances();
            
            // Confirm funding
            console.log('\n⚠️  FUNDING CONFIRMATION');
            console.log(`📤 About to fund ${this.derivedAccounts.length} accounts with 250 tokens each`);
            console.log(`💰 Total funding: ${this.derivedAccounts.length * 250} tokens`);
            console.log(`👥 Target accounts: 9-20 (extended accounts)`);
            
            // Wait for user confirmation (you can skip this in automated environments)
            console.log('\n▶️  Starting funding in 5 seconds... (Ctrl+C to cancel)');
            await new Promise(resolve => setTimeout(resolve, 5000));
            
            // Fund all accounts
            const results = await this.fundAllAccounts();
            
            // Check final balances
            await this.checkFinalBalances();
            
            // Determine exit code
            const successCount = results.filter(r => r.success).length;
            if (successCount === this.derivedAccounts.length) {
                console.log('\n🎉 All accounts funded successfully!');
                process.exit(0);
            } else {
                console.log('\n⚠️  Some accounts failed to fund. Please check the results above.');
                process.exit(1);
            }
            
        } catch (error) {
            console.error('❌ Fatal error in funding process:', error.message);
            process.exit(1);
        }
    }
}

// Main execution
async function main() {
    const funder = new ExtendedAccountFunder();
    await funder.run();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT. Cancelling funding process...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM. Cancelling funding process...');
    process.exit(0);
});

main().catch((error) => {
    console.error('❌ Fatal error in main:', error.message || error);
    process.exit(1);
});