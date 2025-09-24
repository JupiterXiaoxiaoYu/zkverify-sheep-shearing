const { ApiPromise, WsProvider } = require('@polkadot/api');

class SimpleNonceMonitor {
    constructor() {
        this.api = null;
        // Public account addresses for monitoring
        this.monitoredAccounts = [
            'xpk9cG8CYgeTQWgQijTjhWV8JD39XG2nCEC7UnEmv1p6RcAu3',
            'xpiyY2Rtb6bep2nrv39b8MLiVqJLrFBrfn4oxbRBeCRFKJFLD', 
            'xphaJKVzE99CLs2kg5bxQcVw2L3XDaMmenknXfGcStKc1cYbs',
            'xpiWhrkB9TcAALsqSphzWtUNaE1zbpgszyB84TcPV8Z68rLKR',
            'xpgejwybPeeLVg6e4oph4HAdfiMuygdmaPwTLj3sh2NYmqHDf',
            'xphvGTfuA1wVRtLw4wdXsuCFvnS9gxsgAJzRgWAcQJTEpUAJ2',
            'xpj6g6JWZZ888MKkTNAWrQXd7GkXNaowQRXNjaPt8euUr3SX1',
            'xph585ZG4acWJYBkDafX8ry2gacpSbXtheLC2zihYVtU4hLYN'
        ];
        
        // Historical data storage
        this.nonceHistory = new Map();
        this.startTime = Date.now();
    }

    async initializeAPI() {
        try {
            console.log('🚀 Connecting to zkVerify blockchain...');
            
            // Connect to zkVerify testnet
            const provider = new WsProvider('wss://testnet-rpc.zkverify.io');
            this.api = await ApiPromise.create({ provider });
            
            await this.api.isReady;
            
            const [chain, nodeName, nodeVersion] = await Promise.all([
                this.api.rpc.system.chain(),
                this.api.rpc.system.name(),
                this.api.rpc.system.version()
            ]);
            
            console.log(`✅ Connected to ${chain} using ${nodeName} v${nodeVersion}`);
            console.log(`📊 Monitoring ${this.monitoredAccounts.length} accounts\n`);
            
            this.monitoredAccounts.forEach((address, index) => {
                console.log(`   Account ${index + 1}: ${address}`);
            });
            
            return true;
        } catch (error) {
            console.error('❌ Failed to connect to blockchain:', error.message);
            return false;
        }
    }

    async getAccountNonce(address) {
        try {
            const accountInfo = await this.api.query.system.account(address);
            return accountInfo.nonce.toNumber();
        } catch (error) {
            console.error(`❌ Failed to get nonce for ${address.slice(0, 8)}...`, error.message);
            return null;
        }
    }

    getNonceAtTime(address, minutesAgo) {
        const history = this.nonceHistory.get(address);
        if (!history || history.length === 0) return null;
        
        const targetTime = Date.now() - (minutesAgo * 60 * 1000);
        
        let closestEntry = null;
        for (const entry of history) {
            if (entry.timestamp <= targetTime) {
                if (!closestEntry || entry.timestamp > closestEntry.timestamp) {
                    closestEntry = entry;
                }
            }
        }
        
        return closestEntry ? closestEntry.nonce : null;
    }

    calculateNonceIncrease(address, minutesAgo) {
        const currentHistory = this.nonceHistory.get(address);
        if (!currentHistory || currentHistory.length === 0) return 'N/A';
        
        const currentNonce = currentHistory[currentHistory.length - 1].nonce;
        const pastNonce = this.getNonceAtTime(address, minutesAgo);
        
        if (pastNonce === null) return 'N/A';
        
        return currentNonce - pastNonce;
    }

    async checkAllNonces() {
        console.log('\n📊 Checking nonces for all monitored accounts...\n');
        
        const results = [];
        
        // Check nonces for all accounts
        for (let i = 0; i < this.monitoredAccounts.length; i++) {
            const address = this.monitoredAccounts[i];
            const nonce = await this.getAccountNonce(address);
            
            if (nonce !== null) {
                // Store historical data
                const timestamp = Date.now();
                if (!this.nonceHistory.has(address)) {
                    this.nonceHistory.set(address, []);
                }
                
                const history = this.nonceHistory.get(address);
                history.push({ timestamp, nonce });
                
                // Keep only last 3 days of data
                const threeDaysAgo = timestamp - (3 * 24 * 60 * 60 * 1000);
                const filteredHistory = history.filter(entry => entry.timestamp > threeDaysAgo);
                this.nonceHistory.set(address, filteredHistory);
                
                results.push({
                    accountIndex: i + 1,
                    address: address,
                    nonce: nonce,
                    success: true
                });
            } else {
                results.push({
                    accountIndex: i + 1,
                    address: address,
                    nonce: 'Error',
                    success: false
                });
            }
        }
        
        // Display results in table format
        console.log('┌─────────┬──────────────────────────────────────────────┬──────────┬──────────┬──────────┬──────────┬──────────┐');
        console.log('│ Account │ Address                                      │ Nonce    │ 5min     │ 30min    │ 24h      │ 3day     │');
        console.log('├─────────┼──────────────────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');
        
        let totalTransactions = 0;
        let total5min = 0, total30min = 0, total24h = 0, total3day = 0;
        
        results.forEach((result) => {
            const accountStr = `${result.accountIndex}`.padEnd(7);
            const addressStr = `${result.address.slice(0, 8)}...${result.address.slice(-8)}`.padEnd(44);
            const nonceStr = result.success ? `${result.nonce}`.padEnd(8) : 'Error'.padEnd(8);
            
            // Calculate time-based increases
            const increase5min = this.calculateNonceIncrease(result.address, 5);
            const increase30min = this.calculateNonceIncrease(result.address, 30);
            const increase24h = this.calculateNonceIncrease(result.address, 24 * 60);
            const increase3day = this.calculateNonceIncrease(result.address, 3 * 24 * 60);
            
            const inc5minStr = `${increase5min}`.padEnd(8);
            const inc30minStr = `${increase30min}`.padEnd(8);
            const inc24hStr = `${increase24h}`.padEnd(8);
            const inc3dayStr = `${increase3day}`.padEnd(8);
            
            console.log(`│ ${accountStr} │ ${addressStr} │ ${nonceStr} │ ${inc5minStr} │ ${inc30minStr} │ ${inc24hStr} │ ${inc3dayStr} │`);
            
            if (result.success && typeof result.nonce === 'number') {
                totalTransactions += result.nonce;
                
                if (typeof increase5min === 'number') total5min += increase5min;
                if (typeof increase30min === 'number') total30min += increase30min;
                if (typeof increase24h === 'number') total24h += increase24h;
                if (typeof increase3day === 'number') total3day += increase3day;
            }
        });
        
        console.log('├─────────┼──────────────────────────────────────────────┼──────────┼──────────┼──────────┼──────────┼──────────┤');
        console.log(`│ TOTAL   │                                              │ ${`${totalTransactions}`.padEnd(8)} │ ${`${total5min}`.padEnd(8)} │ ${`${total30min}`.padEnd(8)} │ ${`${total24h}`.padEnd(8)} │ ${`${total3day}`.padEnd(8)} │`);
        console.log('└─────────┴──────────────────────────────────────────────┴──────────┴──────────┴──────────┴──────────┴──────────┘');
        
        // Summary statistics
        console.log('\n📈 Summary Statistics:');
        console.log(`   Total transactions across all accounts: ${totalTransactions}`);
        
        const uptime = (Date.now() - this.startTime) / (1000 * 60);
        console.log(`   Uptime: ${Math.floor(uptime)} minutes`);
        
        if (total5min > 0) {
            const rate5min = (total5min / 5).toFixed(1);
            console.log(`   Transaction rate (last 5min): ${total5min} txns (${rate5min} txns/min)`);
        }
        
        if (total30min > 0) {
            const rate30min = (total30min / 30).toFixed(1);
            console.log(`   Transaction rate (last 30min): ${total30min} txns (${rate30min} txns/min)`);
        }
        
        const successfulChecks = results.filter(r => r.success);
        if (successfulChecks.length > 0) {
            const nonces = successfulChecks.map(r => r.nonce);
            const avgNonce = (totalTransactions / successfulChecks.length).toFixed(1);
            const maxNonce = Math.max(...nonces);
            const minNonce = Math.min(...nonces);
            
            console.log(`   Average transactions per account: ${avgNonce}`);
            console.log(`   Highest nonce: ${maxNonce}`);
            console.log(`   Lowest nonce: ${minNonce}`);
            
            const maxAccount = results.find(r => r.nonce === maxNonce);
            const minAccount = results.find(r => r.nonce === minNonce);
            
            console.log(`   Most active: Account ${maxAccount.accountIndex} (${maxNonce} transactions)`);
            console.log(`   Least active: Account ${minAccount.accountIndex} (${minNonce} transactions)`);
        }
        
        return results;
    }

    async runContinuousMonitoring(intervalSeconds = 60) {
        console.log(`\n🔄 Starting continuous monitoring every ${intervalSeconds} seconds...`);
        console.log(`📊 Tracking time-based metrics: 5min, 30min, 24h, 3day\n`);
        
        const runCheck = async () => {
            try {
                const timestamp = new Date().toLocaleString();
                console.log(`\n🕐 [${timestamp}] Checking account nonces...`);
                
                await this.checkAllNonces();
                
                const uptimeHours = ((Date.now() - this.startTime) / (1000 * 60 * 60)).toFixed(1);
                const totalDataPoints = Array.from(this.nonceHistory.values())
                    .reduce((sum, history) => sum + history.length, 0);
                
                console.log(`\n🔍 Monitoring Status:`);
                console.log(`   Uptime: ${uptimeHours} hours`);
                console.log(`   Data points collected: ${totalDataPoints}`);
                console.log(`   Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
                
            } catch (error) {
                console.error('❌ Error in monitoring:', error.message);
            }
            
            console.log(`\n⏳ Next check in ${intervalSeconds} seconds...`);
            setTimeout(runCheck, intervalSeconds * 1000);
        };
        
        runCheck();
    }

    async disconnect() {
        if (this.api) {
            await this.api.disconnect();
            console.log('👋 Disconnected from blockchain');
        }
    }
}

// Main execution
async function main() {
    console.log('🔍 zkVerify Simple Account Monitor');
    console.log('═══════════════════════════════════');
    console.log('📋 Monitors public blockchain transaction activity');
    console.log('🔒 No private keys required\n');
    
    const monitor = new SimpleNonceMonitor();
    const args = process.argv.slice(2);
    
    if (!await monitor.initializeAPI()) {
        console.error('❌ Failed to initialize. Exiting.');
        process.exit(1);
    }
    
    if (args.includes('--continuous')) {
        const intervalIndex = args.indexOf('--interval');
        const interval = intervalIndex !== -1 && args[intervalIndex + 1] ? 
                        parseInt(args[intervalIndex + 1]) : 60;
        
        await monitor.runContinuousMonitoring(interval);
    } else {
        await monitor.checkAllNonces();
        console.log('\n✅ Monitoring check completed');
        await monitor.disconnect();
        process.exit(0);
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down gracefully...');
    process.exit(0);
});

main().catch((error) => {
    console.error('❌ Fatal error:', error.message || error);
    process.exit(1);
});