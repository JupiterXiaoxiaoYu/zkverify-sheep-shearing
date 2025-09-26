module.exports = {
  apps: [{
    name: 'rapidsnark-pipeline',
    script: 'rapidsnark-sha256-pipeline.cjs',
    args: '--continuous --interval 0',
    
    // 自动重启配置
    autorestart: true,
    max_restarts: 10000,
    min_uptime: 10000,  // 最少运行10秒才算成功启动
    restart_delay: 4000, // 重启延迟4秒
    
    // 内存限制和配置
    node_args: '--max-old-space-size=12288 --expose-gc',
    max_memory_restart: '14G', // 内存超过14GB时重启
    
    // 日志配置
    log_file: './logs/pipeline.log',
    error_file: './logs/pipeline-error.log',
    out_file: './logs/pipeline-out.log',
    time: true,
    
    // 环境变量
    env: {
      NODE_ENV: 'production'
    }
  }]
}