const { zkVerifySession } = require("zkverifyjs");
const { ApiPromise, WsProvider } = require('@polkadot/api');
const { Keyring } = require('@polkadot/keyring');
const { cryptoWaitReady } = require('@polkadot/util-crypto');
const dotenv = require('dotenv');

dotenv.config();

class SmartFundBalancer {
    constructor() {
        this.session = null;
        this.api = null;
        this.sender = null;
        this.allAccounts = [];
        this.baseAccountIndex = 0;
    }

    async initialize() {
        try {
            console.log('🚀 Initializing Smart Fund Balancer...');
            
            await cryptoWaitReady();
            
            // Initialize zkVerify session
            this.session = await zkVerifySession.start().Volta().withAccount(process.env.SEED_PHRASE);
            const initialAccountInfo = await this.session.getAccountInfo();
            const baseAddress = initialAccountInfo[0].address;
            
            // Derive accounts
            const derivedAddresses = await this.session.addDerivedAccounts(baseAddress, 7);
            console.log(`✅ Connected to base account and ${derivedAddresses.length} derived accounts`);
            
            // Connect to blockchain API
            const provider = new WsProvider('wss://testnet-rpc.zkverify.io');
            this.api = await ApiPromise.create({ provider });
            
            // Setup keyring
            const keyring = new Keyring({ type: 'sr25519' });
            this.sender = keyring.addFromMnemonic(process.env.SEED_PHRASE);
            
            return true;
        } catch (error) {
            console.error('❌ Initialization failed:', error.message);
            return false;
        }
    }

    async getAllBalances() {
        try {
            console.log('\n💰 Checking current balances...');
            
            const allAccountInfo = await this.session.getAccountInfo();
            this.allAccounts = allAccountInfo.map((account, index) => ({
                index: index,
                address: account.address,
                balance: BigInt(account.freeBalance),
                balanceVOL: Number(BigInt(account.freeBalance) / BigInt('1000000000000000000')),
                isBase: index === 0
            }));
            
            // Display current balances
            console.log('\n📊 Current Account Balances:');
            this.allAccounts.forEach(account => {
                const icon = account.isBase ? '🏦' : '👤';
                const type = account.isBase ? '(Base)' : `(Derived ${account.index})`;
                console.log(`   ${icon} Account ${account.index + 1} ${type}: ${account.balanceVOL} VOL`);
            });
            
            return this.allAccounts;
        } catch (error) {
            console.error('❌ Failed to get balances:', error.message);
            return null;
        }
    }

    calculateOptimalDistribution() {
        const baseAccount = this.allAccounts.find(acc => acc.isBase);
        const derivedAccounts = this.allAccounts.filter(acc => !acc.isBase);
        
        // Total balance available
        const totalBalance = this.allAccounts.reduce((sum, acc) => sum + acc.balance, BigInt(0));
        const totalBalanceVOL = Number(totalBalance / BigInt('1000000000000000000'));
        
        console.log(`\n🧮 Calculating optimal distribution...`);
        console.log(`   Total balance across all accounts: ${totalBalanceVOL} VOL`);
        
        // Target: Base account should have 3x more than each derived account
        // If we have 8 accounts total: base = 3x, others = 1x each
        // Total parts = 3 + 7*1 = 10 parts
        const totalParts = 3 + derivedAccounts.length * 1;
        const balancePerPart = totalBalance / BigInt(totalParts);
        
        const targetBaseBalance = balancePerPart * BigInt(3);
        const targetDerivedBalance = balancePerPart;
        
        const targetBaseVOL = Number(targetBaseBalance / BigInt('1000000000000000000'));
        const targetDerivedVOL = Number(targetDerivedBalance / BigInt('1000000000000000000'));
        
        console.log(`   Target distribution (${totalParts} parts total):`);
        console.log(`   - Base account: ${targetBaseVOL} VOL (3 parts)`);
        console.log(`   - Each derived account: ${targetDerivedVOL} VOL (1 part each)`);
        
        // Calculate transfers needed
        const transfers = [];
        
        // Check each derived account
        derivedAccounts.forEach(account => {
            const difference = targetDerivedBalance - account.balance;
            const differenceVOL = Number(difference / BigInt('1000000000000000000'));
            
            if (difference > BigInt('1000000000000000000')) { // Need more than 1 VOL
                transfers.push({
                    from: baseAccount.address,
                    to: account.address,
                    amount: difference,
                    amountVOL: Math.floor(differenceVOL),
                    toAccount: account.index + 1,
                    reason: `Balance ${account.balanceVOL} VOL → Target ${targetDerivedVOL} VOL`
                });
            }
        });
        
        // Calculate if base account will have enough after transfers
        const totalTransferAmount = transfers.reduce((sum, transfer) => sum + transfer.amount, BigInt(0));
        const baseAfterTransfers = baseAccount.balance - totalTransferAmount;
        const baseAfterTransfersVOL = Number(baseAfterTransfers / BigInt('1000000000000000000'));
        
        console.log(`\n📋 Transfer Plan:`);
        if (transfers.length === 0) {
            console.log('   No transfers needed - all accounts already optimally balanced!');
        } else {
            console.log(`   ${transfers.length} transfers needed:`);
            transfers.forEach((transfer, i) => {
                console.log(`   ${i + 1}. Send ${transfer.amountVOL} VOL to Account ${transfer.toAccount}`);
                console.log(`      ${transfer.reason}`);
            });
            console.log(`   Base account after transfers: ${baseAfterTransfersVOL} VOL`);
            console.log(`   Target base balance: ${targetBaseVOL} VOL`);
            
            if (baseAfterTransfersVOL < targetBaseVOL * 0.9) {
                console.log('   ⚠️  Warning: Base account will be significantly below target after transfers');
            }
        }
        
        return { transfers, targetBaseVOL, targetDerivedVOL };
    }

    async executeTransfers(transfers) {
        if (transfers.length === 0) {
            console.log('\n🎉 No transfers needed - accounts already optimally balanced!');
            return { successful: 0, failed: 0 };
        }
        
        console.log('\n💸 Executing transfers...');
        console.log('=' .repeat(80));
        
        let successful = 0;
        let failed = 0;
        
        for (let i = 0; i < transfers.length; i++) {
            const transfer = transfers[i];
            
            try {
                console.log(`\n🔄 Transfer ${i + 1}/${transfers.length}: ${transfer.amountVOL} VOL`);
                console.log(`   From: Base Account (${transfer.from.slice(0, 8)}...)`);
                console.log(`   To: Account ${transfer.toAccount} (${transfer.to.slice(0, 8)}...)`);
                console.log(`   Reason: ${transfer.reason}`);
                
                // Create transfer transaction
                const tx = this.api.tx.balances.transferAllowDeath(transfer.to, transfer.amount);
                
                // Sign and send
                const hash = await tx.signAndSend(this.sender);
                console.log(`   ✅ Transaction submitted: ${hash.toHex()}`);
                
                successful++;
                
                // Wait between transactions
                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (error) {
                console.error(`   ❌ Transfer ${i + 1} failed:`, error.message);
                failed++;
                await new Promise(resolve => setTimeout(resolve, 3000));
            }
        }
        
        console.log(`\n📊 Transfer Results:`);
        console.log(`   Successful: ${successful}/${transfers.length}`);
        console.log(`   Failed: ${failed}/${transfers.length}`);
        
        return { successful, failed };
    }

    async checkFinalBalances() {
        console.log('\n⏳ Waiting for transactions to process...');
        await new Promise(resolve => setTimeout(resolve, 10000));
        
        console.log('\n💰 Checking final balances...');
        const finalAccountInfo = await this.session.getAccountInfo();
        
        const finalAccounts = finalAccountInfo.map((account, index) => ({
            index: index,
            address: account.address,
            balanceVOL: Number(BigInt(account.freeBalance) / BigInt('1000000000000000000')),
            isBase: index === 0
        }));
        
        const baseAccount = finalAccounts.find(acc => acc.isBase);
        const derivedAccounts = finalAccounts.filter(acc => !acc.isBase);
        const avgDerivedBalance = derivedAccounts.reduce((sum, acc) => sum + acc.balanceVOL, 0) / derivedAccounts.length;
        const balanceRatio = baseAccount.balanceVOL / avgDerivedBalance;
        
        console.log('\n📊 Final Distribution:');
        finalAccounts.forEach(account => {
            const icon = account.isBase ? '🏦' : '👤';
            const type = account.isBase ? '(Base)' : `(Derived ${account.index})`;
            const ratio = account.isBase ? '' : ` (Base:This = ${(baseAccount.balanceVOL / account.balanceVOL).toFixed(1)}:1)`;
            console.log(`   ${icon} Account ${account.index + 1} ${type}: ${account.balanceVOL} VOL${ratio}`);
        });
        
        console.log(`\n🎯 Balance Analysis:`);
        console.log(`   Base account balance: ${baseAccount.balanceVOL} VOL`);
        console.log(`   Average derived balance: ${avgDerivedBalance.toFixed(1)} VOL`);
        console.log(`   Base:Derived ratio: ${balanceRatio.toFixed(1)}:1`);
        console.log(`   Target ratio: 3:1`);
        
        if (balanceRatio >= 2.5 && balanceRatio <= 3.5) {
            console.log(`   ✅ Excellent balance! Ratio is close to target 3:1`);
        } else if (balanceRatio >= 2.0) {
            console.log(`   ✅ Good balance! Ratio is acceptable`);
        } else {
            console.log(`   ⚠️  Suboptimal balance ratio`);
        }
        
        // Check if all derived accounts have enough for operations (≥100 VOL)
        const underfundedAccounts = derivedAccounts.filter(acc => acc.balanceVOL < 100);
        if (underfundedAccounts.length === 0) {
            console.log(`   ✅ All derived accounts have sufficient funds for operations (≥100 VOL)`);
        } else {
            console.log(`   ⚠️  ${underfundedAccounts.length} accounts have <100 VOL and may need more funds`);
        }
        
        return finalAccounts;
    }

    async saveResults(transfers, results, finalBalances) {
        const fs = require('fs');
        if (!fs.existsSync('./data')) {
            fs.mkdirSync('./data');
        }
        
        const balancingData = {
            executionTime: new Date().toISOString(),
            strategy: "3:1 ratio (Base:Derived)",
            transfers: transfers.map(t => ({
                from: "Base Account",
                to: `Account ${t.toAccount}`,
                amountVOL: t.amountVOL,
                reason: t.reason
            })),
            results: results,
            finalBalances: finalBalances.map(acc => ({
                account: `Account ${acc.index + 1}`,
                type: acc.isBase ? 'Base' : 'Derived',
                balanceVOL: acc.balanceVOL
            })),
            analysis: {
                baseBalance: finalBalances.find(acc => acc.isBase).balanceVOL,
                avgDerivedBalance: finalBalances.filter(acc => !acc.isBase)
                    .reduce((sum, acc) => sum + acc.balanceVOL, 0) / 7,
                actualRatio: finalBalances.find(acc => acc.isBase).balanceVOL / 
                    (finalBalances.filter(acc => !acc.isBase)
                        .reduce((sum, acc) => sum + acc.balanceVOL, 0) / 7),
                targetRatio: 3.0
            }
        };
        
        fs.writeFileSync('./data/smart-balancing-results.json', JSON.stringify(balancingData, null, 2));
        console.log('\n💾 Balancing results saved to ./data/smart-balancing-results.json');
    }

    async cleanup() {
        if (this.api) {
            await this.api.disconnect();
        }
    }
}

async function main() {
    console.log('🏦 Smart Fund Balancer for zkVerify Accounts');
    console.log('═══════════════════════════════════════════');
    console.log('📋 Maintains 3:1 ratio between base and derived accounts');
    console.log('🎯 Optimizes fund distribution for parallel proof submission\n');
    
    const balancer = new SmartFundBalancer();
    
    try {
        if (!await balancer.initialize()) {
            process.exit(1);
        }
        
        const accounts = await balancer.getAllBalances();
        if (!accounts) {
            process.exit(1);
        }
        
        const { transfers, targetBaseVOL, targetDerivedVOL } = balancer.calculateOptimalDistribution();
        
        // Ask for confirmation if there are transfers
        if (transfers.length > 0) {
            const totalTransferVOL = transfers.reduce((sum, t) => sum + t.amountVOL, 0);
            console.log(`\n⚠️  About to transfer ${totalTransferVOL} VOL total`);
            console.log(`   This will take approximately ${transfers.length * 5} seconds to complete`);
            console.log(`   Press Ctrl+C to cancel, or wait 10 seconds to proceed...`);
            
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
        const results = await balancer.executeTransfers(transfers);
        const finalBalances = await balancer.checkFinalBalances();
        
        await balancer.saveResults(transfers, results, finalBalances);
        
        console.log('\n✅ Smart fund balancing completed!');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    } finally {
        await balancer.cleanup();
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Balancing cancelled by user');
    process.exit(0);
});

main();