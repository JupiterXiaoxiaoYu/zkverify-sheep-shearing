#!/bin/bash

# 简单的自动重启脚本 - 不需要任何额外工具

echo "🚀 启动自动重启的rapidsnark pipeline..."
echo "💾 系统内存: 16GB | Node.js堆: 12GB"

# 创建日志目录
mkdir -p logs

# 重启计数器
restart_count=0
crash_log="logs/crashes.log"

while true; do
    echo ""
    echo "🔄 启动pipeline (重启次数: $restart_count)..."
    echo "[$(date)] 启动 #$restart_count" >> $crash_log
    
    # 运行程序，设置内存限制
    NODE_OPTIONS="--max-old-space-size=12288 --expose-gc" \
    node rapidsnark-sha256-pipeline.cjs --continuous --interval 0 2>&1 | tee -a logs/pipeline.log
    
    # 获取退出码
    exit_code=$?
    restart_count=$((restart_count + 1))
    
    echo ""
    echo "❌ 程序退出，退出码: $exit_code"
    echo "[$(date)] 崩溃 #$restart_count, 退出码: $exit_code" >> $crash_log
    
    # 等待5秒后重启
    echo "⏳ 5秒后自动重启..."
    sleep 5
done