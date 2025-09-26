#!/bin/bash

# Start script for rapidsnark-sha256-pipeline with increased memory limits

# Set Node.js memory limit to 12GB (75% of 16GB system memory)
# This leaves 4GB for OS and other processes
export NODE_OPTIONS="--max-old-space-size=12288 --max-semi-space-size=256"

# Enable garbage collection exposure for manual GC control
export NODE_OPTIONS="$NODE_OPTIONS --expose-gc"

# Run the pipeline with continuous mode
echo "🚀 Starting rapidsnark pipeline with 12GB heap limit..."
echo "💾 System memory: 16GB | Node.js heap: 12GB | Reserved for OS: 4GB"

node rapidsnark-sha256-pipeline.cjs --continuous --interval 0