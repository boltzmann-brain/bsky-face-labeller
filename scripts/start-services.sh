#!/bin/bash
set -e

echo "Starting Face Detection Labeler services..."
echo ""

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and configure it."
    exit 1
fi

# Get the directory where the script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Start Python face detection services (two instances for load balancing)
echo "Starting Python face detection services..."
PORT=5001 pm2 start python-service/face_service.py \
    --name python-service-1 \
    --interpreter python3 \
    --log python-service.log \
    --time
PORT=5002 pm2 start python-service/face_service.py \
    --name python-service-2 \
    --interpreter python3 \
    --log python-service.log \
    --time

# Wait for Python services to start (longer on first run — downloads buffalo_l models ~350MB)
echo "Waiting for Python services to initialize (first run downloads models, may take a minute)..."
sleep 5

# Start Node.js labeler
echo "Starting Node.js labeler..."
pm2 start npm \
    --name labeler \
    --log labeler.log \
    --time \
    -- start

# Save PM2 configuration
echo "Saving PM2 configuration..."
pm2 save

# Set up PM2 to start on system boot
echo "Configuring PM2 startup script..."
pm2 startup | tail -n 1 > /tmp/pm2-startup.sh
if [ -s /tmp/pm2-startup.sh ]; then
    sudo bash /tmp/pm2-startup.sh
    rm /tmp/pm2-startup.sh
fi

echo ""
echo "✓ Services started successfully!"
echo ""
echo "View status:"
echo "  pm2 status"
echo ""
echo "View logs:"
echo "  pm2 logs"
echo "  pm2 logs python-service-1"
echo "  pm2 logs python-service-2"
echo "  pm2 logs labeler"
echo ""
echo "Stop services:"
echo "  pm2 stop all"
echo ""
