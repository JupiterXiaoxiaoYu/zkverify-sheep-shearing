#!/bin/bash

# Start script for extended rapidsnark-sha256-pipeline with increased memory limits

# Set Node.js memory limit to 12GB (75% of 16GB system memory)
# This leaves 4GB for OS and other processes
export NODE_OPTIONS="--max-old-space-size=12288 --max-semi-space-size=256"

# Run the extended pipeline with continuous mode
echo "🚀 Starting extended rapidsnark pipeline with 12GB heap limit..."
echo "💾 System memory: 16GB | Node.js heap: 12GB | Reserved for OS: 4GB"
echo "👥 Using accounts 9-20 (12 additional parallel accounts)"

node rapidsnark-sha256-pipeline-extended.cjs --continuous --interval 0