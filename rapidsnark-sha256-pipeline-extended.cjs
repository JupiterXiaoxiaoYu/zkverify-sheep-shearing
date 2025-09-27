const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { zkVerifySession, Library, CurveType, ZkVerifyEvents } = require("zkverifyjs");
const dotenv = require('dotenv');
const HealthServer = require('./health-server.cjs');

dotenv.config();

// Global error handlers to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message || error);
    console.log('🔄 Process will continue...');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('🔄 Process will continue...');
});

class RapidsnarkSHA256PipelineExtended {
    constructor() {
        // Use Railway's persistent volume for caching large files
        this.cacheDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || './cache';
        
        // SHA256 circuit paths (k≈19.98, 1,031,716 constraints)  
        this.proverPath = './rapidsnark-prover';
        this.zkeyPath = path.join(this.cacheDir, 'sha256_k20_0000.zkey');
        this.wasmPath = './k20/sha256_k20_js/sha256_k20.wasm';
        this.verificationKeyPath = './k20/sha256_k20_vkey.json';
        
        // Fallback paths if cache doesn't exist
        this.fallbackZkeyPath = './k20/sha256_k20_0000.zkey';
        this.downloadedZkeyPath = '/app/downloaded_files/sha256_k20_0000.zkey';
        
        // Ensure rapidsnark-prover has execute permissions
        this.ensureProverPermissions();
        
        // Temporary file paths
        this.tempDir = '/tmp';
        
        // zkVerify configuration - Extended to 12 additional accounts (beyond existing 8)
        this.session = null;
        this.accountSeed = process.env.SEED_PHRASE;
        this.derivedAccounts = [];
        this.accountCount = 20; // 8 existing + 12 new = 20 total accounts
        this.startIndex = 8; // Start from account 9-20 (12 new accounts)
        
        // Health server for Railway monitoring
        this.healthServer = new HealthServer((process.env.PORT || 8080) + 1); // Different port to avoid conflict
        
        // Statistics
        this.stats = {
            totalAttempts: 0,
            successful: 0,
            failed: 0,
            startTime: Date.now(),
            accountStats: {} // Track stats per account
        };
        
        this.loadVerificationKey();
    }
    
    ensureProverPermissions() {
        try {
            // Check if prover exists and set execute permissions
            if (fs.existsSync(this.proverPath)) {
                fs.chmodSync(this.proverPath, 0o755);
                console.log('✅ Rapidsnark prover permissions set to executable');
            } else {
                console.error('❌ Rapidsnark prover not found at:', this.proverPath);
            }
        } catch (error) {
            console.error('⚠️ Failed to set prover permissions:', error.message);
        }
    }
    
    async ensureCircuitFiles() {
        try {
            console.log('🔍 Checking circuit files...');
            console.log(`📁 Cache directory: ${this.cacheDir}`);
            
            const expectedSize = 541519920; // 516MB
            
            // Check if cached version exists first
            if (fs.existsSync(this.zkeyPath)) {
                const stats = fs.statSync(this.zkeyPath);
                if (stats.size === expectedSize) {
                    console.log('✅ Cached zkey file found and verified');
                    return;
                } else {
                    console.log(`⚠️ Cached zkey file wrong size: ${stats.size} vs expected ${expectedSize}`);
                }
            }
            
            // Check the Git LFS file
            if (fs.existsSync(this.fallbackZkeyPath)) {
                const stats = fs.statSync(this.fallbackZkeyPath);
                console.log(`📋 Git LFS zkey file size: ${stats.size} bytes`);
                
                if (stats.size === expectedSize) {
                    console.log('✅ Git LFS file is correct, setting up cache...');
                    
                    // Ensure cache directory exists
                    if (!fs.existsSync(this.cacheDir)) {
                        fs.mkdirSync(this.cacheDir, { recursive: true });
                        console.log(`📁 Created cache directory: ${this.cacheDir}`);
                    }
                    
                    // Copy to cache for faster access next time
                    console.log('📥 Copying Git LFS file to cache...');
                    fs.copyFileSync(this.fallbackZkeyPath, this.zkeyPath);
                    console.log('✅ Zkey file cached successfully');
                    return;
                    
                } else if (stats.size < 1000) {
                    // This is a Git LFS pointer file, check for downloaded file
                    const content = fs.readFileSync(this.fallbackZkeyPath, 'utf8');
                    console.log('❌ Git LFS pointer detected (file not downloaded):');
                    console.log(content.substring(0, 200));
                    
                    // Check if we have a downloaded file from build process
                    if (fs.existsSync(this.downloadedZkeyPath)) {
                        const downloadedStats = fs.statSync(this.downloadedZkeyPath);
                        console.log(`📥 Found downloaded file: ${downloadedStats.size} bytes`);
                        
                        if (downloadedStats.size === expectedSize) {
                            console.log('✅ Downloaded file is correct, setting up cache...');
                            
                            // Ensure cache directory exists
                            if (!fs.existsSync(this.cacheDir)) {
                                fs.mkdirSync(this.cacheDir, { recursive: true });
                                console.log(`📁 Created cache directory: ${this.cacheDir}`);
                            }
                            
                            // Copy downloaded file to cache
                            console.log('📥 Copying downloaded file to cache...');
                            fs.copyFileSync(this.downloadedZkeyPath, this.zkeyPath);
                            console.log('✅ Zkey file cached successfully from download');
                            return;
                        } else {
                            console.log(`⚠️ Downloaded file wrong size: ${downloadedStats.size} vs expected ${expectedSize}`);
                        }
                    } else {
                        console.log('❌ No downloaded file found at:', this.downloadedZkeyPath);
                    }
                    
                    throw new Error('Git LFS file not downloaded and no valid downloaded file found. Check build process.');
                } else {
                    console.log(`⚠️ Git LFS file wrong size: ${stats.size} vs expected ${expectedSize}`);
                    throw new Error(`Git LFS file corrupted or incomplete: ${stats.size} bytes`);
                }
            } else {
                throw new Error(`Git LFS file missing: ${this.fallbackZkeyPath}`);
            }
            
        } catch (error) {
            console.error('❌ Failed to ensure circuit files:', error.message);
            throw error;
        }
    }
    
    loadVerificationKey() {
        try {
            const vkData = fs.readFileSync(this.verificationKeyPath, 'utf8');
            this.verificationKey = JSON.parse(vkData);
            console.log('✅ SHA256 verification key loaded successfully');
            console.log(`📋 Protocol: ${this.verificationKey.protocol}, Curve: ${this.verificationKey.curve}`);
            console.log(`🔢 Public inputs: ${this.verificationKey.nPublic}, Circuit size: k≈20 (1,031,716 constraints)`);
        } catch (error) {
            console.error('❌ Failed to load verification key:', error.message);
            throw error;
        }
    }
    
    async initializeSession() {
        try {
            console.log('🚀 Initializing extended proof pipeline with 12 additional parallel accounts...');
            console.log('📋 This pipeline uses accounts 9-20 (derived indices 8-19)');
            
            // Debug environment variables
            console.log('🔍 Environment debug:');
            console.log(`   NODE_ENV: ${process.env.NODE_ENV}`);
            console.log(`   PORT: ${process.env.PORT}`);
            console.log(`   SEED_PHRASE exists: ${!!process.env.SEED_PHRASE}`);
            console.log(`   All env vars count: ${Object.keys(process.env).length}`);
            
            // Validate seed phrase before starting
            if (!this.accountSeed) {
                console.error('❌ SEED_PHRASE is undefined');
                console.error('📋 Available environment variables:', Object.keys(process.env).filter(k => !k.includes('PATH')).slice(0, 10));
                throw new Error('SEED_PHRASE environment variable is not set. Please configure it in Railway dashboard.');
            }
            
            console.log(`🔑 Using seed phrase starting with: ${this.accountSeed.split(' ')[0]}...`);
            
            // Ensure circuit files are available (download if needed)
            await this.ensureCircuitFiles();
            
            // Start health server for Railway monitoring
            this.healthServer.start();
            
            // Initialize session with base account
            this.session = await zkVerifySession.start().Volta().withAccount(this.accountSeed);
            
            // Get base account address
            const accountInfo = await this.session.getAccountInfo();
            const baseAddress = accountInfo[0].address;
            console.log(`📍 Base account: ${baseAddress}`);
            
            // Derive ALL 19 accounts (to get accounts 9-20)
            console.log(`🔄 Deriving ${this.accountCount - 1} accounts to access extended range...`);
            const allDerivedAddresses = await this.session.addDerivedAccounts(baseAddress, this.accountCount - 1);
            
            // Store ALL account addresses (base + all derived)
            const allAccounts = [baseAddress, ...allDerivedAddresses];
            
            // Extract only the accounts we need (indices 8-19 = accounts 9-20)
            this.derivedAccounts = allAccounts.slice(this.startIndex, this.accountCount);
            
            console.log(`✅ ${this.derivedAccounts.length} extended accounts ready (accounts 9-20, all single proof):`);
            this.derivedAccounts.forEach((address, index) => {
                const actualAccountNumber = this.startIndex + index + 1; // +1 because accounts are 1-indexed
                console.log(`   Account ${actualAccountNumber}: ${address} (single proof)`);
                this.stats.accountStats[address] = { submitted: 0, successful: 0, failed: 0 };
            });
            
            // Set up event listeners
            this.setupEventListeners();
            
            console.log('✅ Extended pipeline initialized successfully');
            console.log(`🔥 Running 12 parallel accounts (9-20) with single proof strategy`);
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize zkVerify session:', error.message);
            return false;
        }
    }
    
    setupEventListeners() {
        this.session.subscribe([
            {
                event: ZkVerifyEvents.NewAggregationReceipt,
                callback: async (eventData) => {
                    console.log("📧 New aggregation receipt received:", {
                        domainId: eventData.data.domainId,
                        aggregationId: eventData.data.aggregationId,
                        blockHash: eventData.blockHash
                    });
                    
                    // Only log aggregation data, no file storage
                    try {
                        const aggregationData = {
                            blockHash: eventData.blockHash,
                            domainId: parseInt(eventData.data.domainId),
                            aggregationId: parseInt(eventData.data.aggregationId.replace(/,/g, '')),
                            timestamp: new Date().toISOString()
                        };
                        
                        console.log(`📧 Aggregation receipt: ID ${aggregationData.aggregationId}, Domain ${aggregationData.domainId}, Block ${eventData.blockHash.slice(0,8)}...`);
                    } catch (error) {
                        console.error('❌ Error processing aggregation data:', error);
                    }
                },
                options: { domainId: 0 },
            },
        ]);
    }
    
    generateRandomSHA256Input() {
        // Generate random 16384-bit input for SHA256 k20
        const input = [];
        for (let i = 0; i < 16384; i++) {
            input.push(Math.floor(Math.random() * 2)); // Random 0 or 1
        }
        return input;
    }
    
    getAccountTempPaths(accountIndex, proofId = '') {
        // Create unique temp file paths for each account and proof
        const actualAccountNumber = this.startIndex + accountIndex + 1;
        const uniqueId = proofId ? `ext${actualAccountNumber}_${proofId}` : `ext${actualAccountNumber}`;
        const timestamp = Date.now();
        return {
            witnessPath: path.join(this.tempDir, `sha256_witness_${uniqueId}_${timestamp}.wtns`),
            proofPath: path.join(this.tempDir, `rapidsnark_sha256_proof_${uniqueId}_${timestamp}.json`),
            publicPath: path.join(this.tempDir, `rapidsnark_sha256_public_${uniqueId}_${timestamp}.json`),
            inputFile: path.join(this.tempDir, `sha256_input_${uniqueId}_${timestamp}.json`)
        };
    }

    cleanupTempFiles(filePaths) {
        // Clean up specific temporary files
        if (Array.isArray(filePaths)) {
            filePaths.forEach(filePath => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (error) {
                    // Ignore cleanup errors
                }
            });
        } else if (typeof filePaths === 'object') {
            Object.values(filePaths).forEach(filePath => {
                try {
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (error) {
                    // Ignore cleanup errors
                }
            });
        }
    }
    
    async generateWitnessWithSnarkjs(input, accountIndex, proofId = '') {
        return new Promise((resolve, reject) => {
            const actualAccountNumber = this.startIndex + accountIndex + 1;
            const label = proofId ? `${proofId}` : 'single';
            console.log(`🔨 Generating witness ${label} for account ${actualAccountNumber}...`);
            
            const paths = this.getAccountTempPaths(accountIndex, proofId);
            
            // Create input file
            fs.writeFileSync(paths.inputFile, JSON.stringify({ in: input }));
            
            // Generate witness using snarkjs
            const snarkjs = spawn('npx', [
                'snarkjs',
                'wtns',
                'calculate',
                this.wasmPath,
                paths.inputFile,
                paths.witnessPath
            ]);
            
            let stderr = '';
            snarkjs.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            snarkjs.on('close', (code) => {
                if (code === 0) {
                    console.log(`✅ Witness ${label} generated successfully for account ${actualAccountNumber}`);
                    resolve({ input, paths });
                } else {
                    this.cleanupTempFiles(paths);
                    reject(new Error(`Witness generation failed with code ${code}. Error: ${stderr}`));
                }
            });
            
            snarkjs.on('error', (error) => {
                reject(new Error(`Failed to start witness generation: ${error.message}`));
            });
        });
    }
    
    async generateProofWithRapidsnark(witnessData, proofId = '') {
        return new Promise((resolve, reject) => {
            const { paths } = witnessData;
            const label = proofId ? `${proofId}` : 'single';
            console.log(`⚡ Generating proof ${label} with rapidsnark...`);
            
            // Clean up previous temp files
            [paths.proofPath, paths.publicPath].forEach(filePath => {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
            
            const prover = spawn(this.proverPath, [
                this.zkeyPath,
                paths.witnessPath,
                paths.proofPath,
                paths.publicPath
            ]);
            
            let stderr = '';
            
            prover.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            prover.on('close', (code) => {
                if (code === 0) {
                    try {
                        // Read and clean generated proof and public inputs
                        const proofRaw = fs.readFileSync(paths.proofPath, 'utf8').replace(/\0/g, '').trim();
                        const publicRaw = fs.readFileSync(paths.publicPath, 'utf8').replace(/\0/g, '').trim();
                        
                        const proofData = JSON.parse(proofRaw);
                        const publicInputsRaw = JSON.parse(publicRaw);
                        // Keep as string array for zkVerify compatibility
                        const publicInputs = publicInputsRaw;
                        
                        console.log(`✅ Proof ${label} generated successfully!`);
                        console.log(`📋 Public signals: [${publicInputs.slice(0, 3).join(', ')}...] (${publicInputs.length} total)`);
                        
                        // Clean up temp files after successful proof generation
                        this.cleanupTempFiles(paths);
                        
                        resolve({
                            proof: proofData,
                            publicInputs: publicInputs,
                            paths: paths
                        });
                    } catch (readError) {
                        reject(new Error(`Failed to read generated files: ${readError.message}`));
                    }
                } else {
                    this.cleanupTempFiles(paths);
                    reject(new Error(`Rapidsnark prover exited with code ${code}. Error: ${stderr}`));
                }
            });
            
            prover.on('error', (error) => {
                reject(new Error(`Failed to start rapidsnark prover: ${error.message}`));
            });
        });
    }
    
    async submitProof(proofData, publicInputs, mockInputSummary, accountAddress, accountIndex, proofType = '') {
        const maxRetries = 3;
        let retryCount = 0;
        const actualAccountNumber = this.startIndex + accountIndex + 1;
        
        while (retryCount < maxRetries) {
            try {
                const proofLabel = proofType ? ` ${proofType}` : '';
                console.log(`🔢 Submitting proof${proofLabel} from account ${actualAccountNumber} (${accountAddress.slice(0, 8)}...)...${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
                
                // Submit to zkVerify with promise wrapper to catch async errors
                const submissionPromise = new Promise(async (resolve, reject) => {
                    try {
                        const { events } = await this.session.verify(accountAddress)
                            .groth16({library: Library.snarkjs, curve: CurveType.bn128})
                            .execute({
                                proofData: {
                                    vk: this.verificationKey,
                                    proof: proofData,
                                    publicSignals: publicInputs
                                }, 
                                domainId: 0
                            });

                        // Handle submission events with automatic cleanup
                        const handleIncludedInBlock = (eventData) => {
                            console.log(`✅ Proof${proofLabel} from account ${actualAccountNumber} included in block:`, {
                                account: `${accountAddress.slice(0, 8)}...`,
                                statement: eventData.statement,
                                aggregationId: eventData.aggregationId,
                                inputSummary: mockInputSummary
                            });
                            
                            // Clean up event listeners and timeout to prevent memory leaks
                            clearTimeout(timeoutId);
                            events.removeListener(ZkVerifyEvents.IncludedInBlock, handleIncludedInBlock);
                            events.removeListener('error', handleError);
                            
                            // Only log submission details, no file storage
                            console.log(`✅ Submission ${this.stats.totalAttempts}: Account ${actualAccountNumber}, Statement ${eventData.statement}, AggregationID ${eventData.aggregationId}`);
                            
                            resolve(true);
                        };

                        const handleError = (error) => {
                            clearTimeout(timeoutId);
                            events.removeListener(ZkVerifyEvents.IncludedInBlock, handleIncludedInBlock);
                            events.removeListener('error', handleError);
                            reject(error);
                        };

                        events.on(ZkVerifyEvents.IncludedInBlock, handleIncludedInBlock);
                        events.on('error', handleError);

                        // Set timeout for the submission with cleanup
                        const timeoutId = setTimeout(() => {
                            events.removeListener(ZkVerifyEvents.IncludedInBlock, handleIncludedInBlock);
                            events.removeListener('error', handleError);
                            reject(new Error('Submission timeout after 20 seconds'));
                        }, 20000);

                    } catch (error) {
                        reject(error);
                    }
                });

                // Wait for submission to complete
                await submissionPromise;
                return; // Success, exit retry loop
                
            } catch (error) {
                retryCount++;
                const proofLabel = proofType ? ` ${proofType}` : '';
                let errorMessage = 'Unknown error';
                if (error && typeof error === 'object') {
                    errorMessage = error.message || JSON.stringify(error) || error.toString();
                } else if (error) {
                    errorMessage = error.toString();
                }
                console.error(`❌ Error submitting proof${proofLabel} #${this.stats.totalAttempts} from account ${actualAccountNumber} (attempt ${retryCount}):`, errorMessage);
                
                // Check for specific errors that should trigger retry
                const shouldRetry = 
                    errorMessage.includes('Priority is too low') ||
                    errorMessage.includes('already in the pool') ||
                    errorMessage.includes('disconnected') ||
                    errorMessage.includes('Abnormal Closure') ||
                    errorMessage.includes('Connection') ||
                    errorMessage.includes('timeout') ||
                    errorMessage.includes('not found in session') ||
                    errorMessage.includes('1014:');
                
                if (shouldRetry && retryCount < maxRetries) {
                    // Priority is too low错误使用3秒间隔，其他错误使用5秒
                    const retryDelay = errorMessage.includes('Priority is too low') ? 3000 : 5000;
                    const delayText = errorMessage.includes('Priority is too low') ? '3 seconds' : '5 seconds';
                    console.log(`⏳ Waiting ${delayText} before retry...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    
                    // Try to reconnect session if it's a connection error
                    if (errorMessage.includes('disconnected') || errorMessage.includes('Abnormal Closure') || errorMessage.includes('not found in session')) {
                        console.log('🔄 Attempting to reconnect session with derived accounts...');
                        try {
                            await this.reconnectSessionWithDerivedAccounts();
                            console.log('✅ Session and derived accounts reconnected successfully');
                        } catch (reconnectError) {
                            console.error('❌ Failed to reconnect session:', reconnectError?.message || reconnectError);
                        }
                    }
                } else {
                    // Either not a retryable error or max retries reached
                    if (retryCount >= maxRetries) {
                        console.error(`❌ Max retries (${maxRetries}) reached for proof${proofLabel} #${this.stats.totalAttempts} from account ${actualAccountNumber}`);
                    }
                    // Don't throw error, just log and continue with next proof
                    break;
                }
            }
        }
    }
    
    async runSingleProofCycleAsync(accountIndex, batchId = '') {
        const accountAddress = this.derivedAccounts[accountIndex];
        const actualAccountNumber = this.startIndex + accountIndex + 1;
        
        try {
            const startTime = Date.now();
            console.log(`\n🔄 [${new Date().toLocaleTimeString()}] Starting single SHA256 proof for account ${actualAccountNumber} (${accountAddress.slice(0, 8)}...) [${batchId}]`);
            
            // Generate random input for SHA256
            const randomInput = this.generateRandomSHA256Input();
            const inputSummary = {
                totalBits: randomInput.length,
                onesCount: randomInput.filter(bit => bit === 1).length,
                zerosCount: randomInput.filter(bit => bit === 0).length,
                firstBytes: randomInput.slice(0, 32).join('')
            };
            
            console.log(`🎲 Generated random ${randomInput.length}-bit input for account ${actualAccountNumber}: ${inputSummary.onesCount} ones, ${inputSummary.zerosCount} zeros`);
            
            // Generate witness
            const witnessStart = Date.now();
            console.log(`🔧 [${new Date().toLocaleTimeString()}] [${batchId}] Witness generation phase for account ${actualAccountNumber}`);
            const witnessData = await this.generateWitnessWithSnarkjs(randomInput, accountIndex, 'extended');
            const witnessTime = Date.now() - witnessStart;
            console.log(`✅ [${new Date().toLocaleTimeString()}] [${batchId}] Witness completed for account ${actualAccountNumber} (${witnessTime}ms)`);
            
            // Generate proof with rapidsnark  
            const proofStart = Date.now();
            console.log(`⚡ [${new Date().toLocaleTimeString()}] [${batchId}] Proof generation phase for account ${actualAccountNumber}`);
            const { proof, publicInputs } = await this.generateProofWithRapidsnark(witnessData, 'extended');
            const proofTime = Date.now() - proofStart;
            console.log(`✅ [${new Date().toLocaleTimeString()}] [${batchId}] Proof completed for account ${actualAccountNumber} (${proofTime}ms)`);
            
            // Submit proof asynchronously
            const submitStart = Date.now();
            console.log(`📤 [${new Date().toLocaleTimeString()}] [${batchId}] Proof submission initiated for account ${actualAccountNumber}`);
            
            const submitPromise = this.submitProof(proof, publicInputs, inputSummary, accountAddress, accountIndex, 'Extended').then(() => {
                const submitTime = Date.now() - submitStart;
                console.log(`✅ [${new Date().toLocaleTimeString()}] [${batchId}] Proof submit completed for account ${actualAccountNumber} (${submitTime}ms)`);
                return { accountIndex, proofType: 'Extended', success: true, submitTime };
            }).catch((error) => {
                const submitTime = Date.now() - submitStart;
                const errorMessage = error?.message || JSON.stringify(error) || error.toString();
                console.log(`❌ [${new Date().toLocaleTimeString()}] [${batchId}] Proof submit failed for account ${actualAccountNumber}: ${errorMessage}`);
                return { accountIndex, proofType: 'Extended', success: false, error: errorMessage, submitTime };
            });
            
            const proofGenerationTime = Date.now() - startTime;
            console.log(`🚀 [${new Date().toLocaleTimeString()}] [${batchId}] Extended proof generation completed for account ${actualAccountNumber} (${proofGenerationTime}ms)`);
            console.log(`⏱️ [${batchId}] Timing - Witness: ${witnessTime}ms, Proof: ${proofTime}ms, Total: ${proofGenerationTime}ms`);
            
            // Return submit promise for monitoring
            return submitPromise;
            
        } catch (error) {
            let errorMessage;
            
            try {
                errorMessage = error?.message || JSON.stringify(error) || error.toString();
            } catch (stringifyError) {
                errorMessage = 'Unknown error occurred';
            }
            
            console.error(`❌ Extended SHA256 proof cycle failed for account ${actualAccountNumber}: ${errorMessage}\n`);
            throw error;
        }
    }
    
    async runParallelProofCycles() {
        const cycleStartTime = Date.now();
        console.log(`\n🚀 [${new Date().toLocaleTimeString()}] Starting full parallel proof generation across ${this.derivedAccounts.length} extended accounts (9-20)...`);
        
        // 健康检查：确保所有账号的统计数据存在
        this.ensureAccountStatsIntegrity();
        
        // Promise池管理 - 收集所有submit promises
        const submitPromises = [];
        
        // 所有账户同时开始，不分batch
        console.log(`📊 [${new Date().toLocaleTimeString()}] All ${this.derivedAccounts.length} extended accounts starting simultaneously`);
        
        const allProofPromises = this.derivedAccounts.map(async (accountAddress, index) => {
            try {
                // All extended accounts use single proof strategy
                this.stats.accountStats[accountAddress].submitted++;
                
                const actualAccountNumber = this.startIndex + index + 1;
                const submitPromise = await this.runSingleProofCycleAsync(index, `ExtAccount${actualAccountNumber}-Single`);
                submitPromises.push({ 
                    accountIndex: index, 
                    promise: submitPromise, 
                    proofType: 'Extended' 
                });
                
                // Note: 成功统计在monitorAsyncSubmissions中处理
            } catch (error) {
                this.stats.failed += 1; // 一个proof失败
                // Error already logged in respective cycle methods
            }
        });
        
        // Wait for all proof generation to complete (不等待submit)
        console.log(`⚡ [${new Date().toLocaleTimeString()}] Waiting for all ${this.derivedAccounts.length} extended proof generations to complete...`);
        await Promise.all(allProofPromises);
        
        const proofGenerationEndTime = Date.now();
        const proofGenerationTime = proofGenerationEndTime - cycleStartTime;
        
        console.log(`🎯 [${new Date().toLocaleTimeString()}] All extended proof generation completed in ${(proofGenerationTime/1000).toFixed(1)}s`);
        console.log(`📋 Monitoring ${submitPromises.length} async submissions...`);
        
        // 异步监控submit结果 (不阻塞下一个cycle)
        this.monitorAsyncSubmissions(submitPromises, cycleStartTime);
        
        const cycleEndTime = Date.now();
        const totalCycleTime = cycleEndTime - cycleStartTime;
        
        // Calculate total attempts: All 12 accounts = 12 proofs
        const totalAttemptsThisCycle = this.derivedAccounts.length;
        this.stats.totalAttempts += totalAttemptsThisCycle;
        
        // Print summary statistics with timing (proof generation only)
        console.log(`\n📊 [${new Date().toLocaleTimeString()}] Extended parallel cycle completed (proof generation):`);
        console.log(`   Accounts 9-20 (extended): ${this.derivedAccounts.length} single proofs`);
        console.log(`   Total attempts this cycle: ${totalAttemptsThisCycle}`);
        console.log(`   Proof generation time: ${(proofGenerationTime/1000).toFixed(1)}s`);
        console.log(`   Submit monitoring: ${submitPromises.length} async submissions in progress`);
        console.log(`   ⚡ Extended strategy: ${this.derivedAccounts.length} parallel single proof accounts`);
        
        // Update health server statistics
        this.healthServer.updateProofStats(this.stats.totalAttempts, this.stats.successful, this.stats.failed);
        
        // Periodic memory cleanup every 50 cycles (more frequent)
        if (this.stats.totalAttempts % 50 === 0) {
            this.performMemoryCleanup();
        }
        
        // Periodic account health check every 100 cycles (every ~50 minutes at 30s intervals)
        if (this.stats.totalAttempts % 100 === 0) {
            console.log('\n🏥 Performing periodic account health check...');
            await this.validateAccountSessions();
        }
    }

    getSystemStats() {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        
        // Convert to more readable format
        const stats = {
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
                rss: Math.round(memUsage.rss / 1024 / 1024), // MB (Resident Set Size)
                external: Math.round(memUsage.external / 1024 / 1024), // MB
                arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024), // MB
                heapPercentage: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
                systemPercentage: Math.round((memUsage.rss / (16 * 1024 * 1024 * 1024)) * 100) // 16GB system
            },
            cpu: {
                user: Math.round(cpuUsage.user / 1000), // Convert microseconds to milliseconds
                system: Math.round(cpuUsage.system / 1000)
            }
        };
        
        return stats;
    }

    ensureAccountStatsIntegrity() {
        let fixedAccounts = 0;
        
        this.derivedAccounts.forEach((address, index) => {
            const actualAccountNumber = this.startIndex + index + 1;
            if (!this.stats.accountStats[address]) {
                console.log(`🔧 Restoring missing stats for account ${actualAccountNumber} (${address.slice(0, 8)}...)`);
                this.stats.accountStats[address] = { submitted: 0, successful: 0, failed: 0 };
                fixedAccounts++;
            }
        });
        
        if (fixedAccounts > 0) {
            console.log(`✅ Restored stats for ${fixedAccounts} extended accounts`);
        }
    }
    
    async validateAccountSessions() {
        // 验证所有账号的session是否有效
        console.log('🔍 Validating extended account sessions...');
        
        try {
            // 检查主session
            const accountInfo = await this.session.getAccountInfo();
            if (!accountInfo || accountInfo.length === 0) {
                throw new Error('Main session invalid');
            }
            
            // 检查派生账号数量
            if (this.derivedAccounts.length !== (this.accountCount - this.startIndex)) {
                throw new Error(`Extended accounts count mismatch: ${this.derivedAccounts.length} vs ${this.accountCount - this.startIndex}`);
            }
            
            console.log(`✅ All ${this.derivedAccounts.length} extended account sessions validated`);
            return true;
            
        } catch (error) {
            console.log(`❌ Extended session validation failed: ${error.message}`);
            console.log('🔄 Attempting full session recovery...');
            
            try {
                await this.reconnectSessionWithDerivedAccounts();
                this.ensureAccountStatsIntegrity();
                
                // 验证重连后的session是否正常
                const testAccountInfo = await this.session.getAccountInfo();
                if (!testAccountInfo || testAccountInfo.length === 0) {
                    throw new Error('Session recovery failed - account info still invalid');
                }
                
                console.log('✅ Full extended session recovery completed and validated');
                return true;
                
            } catch (recoveryError) {
                console.error('❌ Extended session recovery failed:', recoveryError.message);
                console.log('🚨 CRITICAL: Extended session cannot be recovered, full restart recommended');
                console.log('💡 Consider restarting the entire process to resolve fee/nonce issues');
                
                // 可以选择在这里触发程序退出，让auto-restart.sh重启
                // process.exit(1);
                
                return false;
            }
        }
    }

    performMemoryCleanup(forceCleanup = false) {
        try {
            const beforeStats = this.getSystemStats();
            console.log('\n🧹 Performing extended memory cleanup...');
            console.log(`📊 Before cleanup: ${beforeStats.memory.heapUsed}MB heap, ${beforeStats.memory.rss}MB RSS (${beforeStats.memory.systemPercentage}% of 16GB)`);
            
            // Adjust cleanup strategy based on 16GB total memory
            let maxDataFiles = 100; // Default
            let shouldForceGC = forceCleanup;
            
            if (beforeStats.memory.systemPercentage > 50) { // > 8GB (50% of 16GB)
                maxDataFiles = 20; // Aggressive cleanup
                shouldForceGC = true;
                console.log(`⚠️  High system memory usage: ${beforeStats.memory.systemPercentage}% (${beforeStats.memory.rss}MB / 16GB)`);
            } else if (beforeStats.memory.systemPercentage > 25) { // > 4GB (25% of 16GB)
                maxDataFiles = 50; // Moderate cleanup
                shouldForceGC = true;
                console.log(`📈 Moderate memory usage: ${beforeStats.memory.systemPercentage}% (${beforeStats.memory.rss}MB / 16GB)`);
            } else if (beforeStats.memory.heapPercentage > 80) {
                shouldForceGC = true; // Force GC if heap is > 80% full
            }
            
            // No file cleanup needed since we don't store files
            console.log('🗑️  No data files to clean up (file storage disabled)');
            
            // Force garbage collection if needed
            if (shouldForceGC && global.gc) {
                global.gc();
                console.log('♻️  Forced garbage collection');
                
                // Wait a bit for GC to complete
                setTimeout(() => {
                    const afterStats = this.getSystemStats();
                    const memoryFreed = beforeStats.memory.heapUsed - afterStats.memory.heapUsed;
                    const rssFreed = beforeStats.memory.rss - afterStats.memory.rss;
                    
                    console.log(`📊 After cleanup: ${afterStats.memory.heapUsed}MB heap, ${afterStats.memory.rss}MB RSS (${afterStats.memory.systemPercentage}% of 16GB)`);
                    if (memoryFreed > 0) {
                        console.log(`✅ Freed ${memoryFreed}MB heap, ${rssFreed}MB RSS`);
                    }
                }, 1000);
            }
            
        } catch (error) {
            console.error('❌ Error during extended memory cleanup:', error.message);
        }
    }
    
    async reconnectSessionWithDerivedAccounts() {
        try {
            console.log('🔄 Full extended session reconnection and account state refresh...');
            
            // 完全清理旧session
            if (this.session) {
                try {
                    // 尝试优雅关闭旧session
                    await this.session.close();
                } catch (closeError) {
                    console.log('⚠️ Old session close failed, continuing with new session');
                }
                this.session = null;
            }
            
            // 等待一段时间确保旧连接完全关闭
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 重新建立完全新的session
            console.log('🚀 Creating fresh zkVerify session for extended accounts...');
            this.session = await zkVerifySession.start().Volta().withAccount(this.accountSeed);
            
            // 获取基础账号信息并等待状态同步
            const accountInfo = await this.session.getAccountInfo();
            const baseAddress = accountInfo[0].address;
            console.log(`📍 Base account reconnected: ${baseAddress}`);
            
            // 等待账号状态完全同步
            console.log('⏳ Waiting for account state synchronization...');
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // 重新派生所有账号 (需要全部19个才能访问8-19索引)
            console.log(`🔄 Re-deriving ${this.accountCount - 1} fresh accounts to access extended range...`);
            const allDerivedAddresses = await this.session.addDerivedAccounts(baseAddress, this.accountCount - 1);
            
            // 重新提取我们需要的账号 (索引8-19)
            const allAccounts = [baseAddress, ...allDerivedAddresses];
            this.derivedAccounts = allAccounts.slice(this.startIndex, this.accountCount);
            
            // 等待派生账号状态同步
            console.log('⏳ Waiting for extended accounts state synchronization...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 重新设置事件监听器
            this.setupEventListeners();
            
            // 重新初始化所有账号的统计数据
            this.derivedAccounts.forEach((address, index) => {
                const actualAccountNumber = this.startIndex + index + 1;
                this.stats.accountStats[address] = { submitted: 0, successful: 0, failed: 0 };
                console.log(`   Account ${actualAccountNumber}: ${address} (stats reset)`);
            });
            
            console.log(`✅ Full extended session reconnection completed with ${this.derivedAccounts.length} accounts`);
            console.log('🔄 All extended account states synchronized and ready for proof submission');
            
        } catch (error) {
            console.error('❌ Failed to reconnect extended session with derived accounts:', error.message);
            console.log('🚨 Critical: Extended session reconnection failed, program may need full restart');
            throw error;
        }
    }
    
    async monitorAsyncSubmissions(submitPromises, cycleStartTime) {
        // 在后台监控所有submit结果，不阻塞主流程
        console.log(`🔍 [${new Date().toLocaleTimeString()}] Starting background monitoring of ${submitPromises.length} extended submissions...`);
        
        try {
            const submitResults = await Promise.allSettled(submitPromises.map(item => item.promise));
            const monitorEndTime = Date.now();
            const totalSubmitTime = monitorEndTime - cycleStartTime;
            
            // 统计submit结果
            let successfulSubmits = 0;
            let failedSubmits = 0;
            const submitTimes = [];
            
            submitResults.forEach((result, index) => {
                const accountIndex = submitPromises[index].accountIndex;
                const accountAddress = this.derivedAccounts[accountIndex];
                const actualAccountNumber = this.startIndex + accountIndex + 1;
                
                if (result.status === 'fulfilled' && result.value.success) {
                    successfulSubmits++;
                    submitTimes.push(result.value.submitTime);
                    // 更新账户级别的成功统计
                    if (this.stats.accountStats[accountAddress]) {
                        this.stats.accountStats[accountAddress].successful++;
                    }
                } else {
                    failedSubmits++;
                    console.log(`❌ Background submit failed for account ${actualAccountNumber}:`, result.reason || result.value?.error);
                    // 更新账户级别的失败统计
                    if (this.stats.accountStats[accountAddress]) {
                        this.stats.accountStats[accountAddress].failed++;
                    }
                }
            });
            
            // 打印详细的submit统计
            const avgSubmitTime = submitTimes.length > 0 ? submitTimes.reduce((a, b) => a + b, 0) / submitTimes.length : 0;
            const maxSubmitTime = submitTimes.length > 0 ? Math.max(...submitTimes) : 0;
            const minSubmitTime = submitTimes.length > 0 ? Math.min(...submitTimes) : 0;
            
            console.log(`\n📈 [${new Date().toLocaleTimeString()}] Extended Async Submit Results:`);
            console.log(`   ✅ Successful submissions: ${successfulSubmits}/${submitPromises.length}`);
            console.log(`   ❌ Failed submissions: ${failedSubmits}/${submitPromises.length}`);
            console.log(`   ⏱️ Submit timing - Avg: ${avgSubmitTime.toFixed(0)}ms, Min: ${minSubmitTime}ms, Max: ${maxSubmitTime}ms`);
            console.log(`   🎯 Total cycle time (including submits): ${(totalSubmitTime/1000).toFixed(1)}s`);
            
            // 更新全局统计
            this.stats.successful += successfulSubmits;
            this.stats.failed += failedSubmits;
            
            // 打印最终账户统计
            console.log(`\n📈 Final Extended Account Statistics:`);
            this.derivedAccounts.forEach((address, index) => {
                const actualAccountNumber = this.startIndex + index + 1;
                const stats = this.stats.accountStats[address];
                if (stats) {
                    const successful = stats.successful || 0;
                    const submitted = stats.submitted || 0;
                    const successRate = submitted > 0 ? ((successful / submitted) * 100).toFixed(1) : 0;
                    console.log(`   Account ${actualAccountNumber} (${address.slice(0, 8)}...): ${successful}/${submitted} successful (${successRate}%)`);
                } else {
                    console.log(`   Account ${actualAccountNumber} (${address.slice(0, 8)}...): ⚠️  Stats missing - will restore next cycle`);
                    // 立即修复缺失的统计
                    this.stats.accountStats[address] = { submitted: 0, successful: 0, failed: 0 };
                }
            });
            
        } catch (error) {
            console.error(`❌ Error monitoring extended async submissions:`, error.message);
        }
    }
    
    async runContinuous(intervalSeconds = 30) {
        const initialStats = this.getSystemStats();
        console.log(`🔄 Starting continuous extended SHA256 proof submission every ${intervalSeconds} seconds...`);
        console.log(`🧮 Circuit: SHA256 (k≈20, 1,031,716 constraints, 16384-bit input)`);
        console.log(`👥 Extended strategy: Accounts 9-20 (all single proof)`);
        console.log(`🖥️  System: 16GB RAM | Initial memory: ${initialStats.memory.rss}MB RSS (${initialStats.memory.systemPercentage}%)`);
        console.log(`📊 Memory thresholds: Cleanup at >4.8GB (30%), Critical at >8GB (50%)`);
        
        const runCycle = async () => {
            try {
                await this.runParallelProofCycles();
                
                // Note: Aggregation receipts will arrive asynchronously and be logged when received
                
            } catch (error) {
                console.error('❌ Error in extended parallel proof cycle:', error);
                // Continue with next cycle
            }
            
            // Calculate runtime statistics
            const runtime = Math.floor((Date.now() - this.stats.startTime) / 1000);
            const hours = Math.floor(runtime / 3600);
            const minutes = Math.floor((runtime % 3600) / 60);
            const seconds = runtime % 60;
            
            // System resource monitoring
            const systemStats = this.getSystemStats();
            
            console.log(`📈 Extended Runtime: ${hours}h ${minutes}m ${seconds}s | Success: ${this.stats.successful} | Failed: ${this.stats.failed}`);
            console.log(`💾 Memory: ${systemStats.memory.heapUsed}MB heap (${systemStats.memory.heapPercentage}%) | ${systemStats.memory.rss}MB RSS (${systemStats.memory.systemPercentage}% of 16GB)`);
            console.log(`🖥️  CPU: ${systemStats.cpu.user}ms user, ${systemStats.cpu.system}ms system | External: ${systemStats.memory.external}MB | Buffers: ${systemStats.memory.arrayBuffers}MB`);
            
            // Adaptive memory management based on 16GB system
            if (systemStats.memory.systemPercentage > 50) { // > 8GB
                console.log(`🚨 Critical memory usage: ${systemStats.memory.systemPercentage}% of 16GB system memory`);
                this.performMemoryCleanup(true); // Force cleanup
            } else if (systemStats.memory.systemPercentage > 30) { // > 4.8GB
                console.log(`⚠️  High memory usage: ${systemStats.memory.systemPercentage}% of 16GB system memory`);
                this.performMemoryCleanup();
            } else if (systemStats.memory.heapUsed > 2048) { // > 2GB heap
                console.log(`📊 Large heap detected: ${systemStats.memory.heapUsed}MB`);
                this.performMemoryCleanup();
            }
            
            console.log(`⏳ Next extended parallel proof cycle in ${intervalSeconds} seconds...`);
            
            setTimeout(runCycle, intervalSeconds * 1000);
        };
        
        // Start first cycle
        runCycle();
    }
    
    async runSingle() {
        try {
            await this.runParallelProofCycles();
            console.log('✅ Single extended parallel SHA256 proof submission completed');
            process.exit(0);
        } catch (error) {
            console.error('❌ Single extended parallel SHA256 proof submission failed');
            process.exit(1);
        }
    }
}

// Main execution
async function main() {
    pipeline = new RapidsnarkSHA256PipelineExtended();
    const args = process.argv.slice(2);
    
    // Initialize session and event listeners first
    if (!await pipeline.initializeSession()) {
        console.error('❌ Failed to initialize extended zkVerify session. Exiting.');
        process.exit(1);
    }
    
    if (args.includes('--continuous')) {
        const intervalIndex = args.indexOf('--interval');
        const interval = intervalIndex !== -1 && args[intervalIndex + 1] ? 
                        parseInt(args[intervalIndex + 1]) : 30;
        
        await pipeline.runContinuous(interval);
    } else {
        await pipeline.runSingle();
    }
}

// Handle graceful shutdown
let pipeline = null;

process.on('SIGINT', () => {
    console.log('\n🛑 Received SIGINT. Shutting down extended pipeline gracefully...');
    if (pipeline && pipeline.healthServer) {
        pipeline.healthServer.stop();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM. Shutting down extended pipeline gracefully...');
    if (pipeline && pipeline.healthServer) {
        pipeline.healthServer.stop();
    }
    process.exit(0);
});

main().catch((error) => {
    console.error('❌ Fatal error in extended main:', error.message || error);
    process.exit(1);
});