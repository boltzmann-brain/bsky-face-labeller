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

# Start Python face detection services. One instance per port in PYTHON_PORTS
# (comma-separated); each port must have a matching entry in PYTHON_SERVICE_URL.
# A single instance is enough unless QUEUE_CONCURRENCY > 1.
echo "Starting Python face detection services..."
VENV_PYTHON="$PROJECT_DIR/python-service/venv/bin/python"
if [ ! -f "$VENV_PYTHON" ]; then
    echo "Error: Python venv not found at $VENV_PYTHON"
    echo "Run deploy.sh, or: uv venv python-service/venv --python 3.12 && uv pip install --python python-service/venv/bin/python -r python-service/requirements.txt"
    exit 1
fi
PYTHON_PORTS="${PYTHON_PORTS:-5000}"
i=1
for port in ${PYTHON_PORTS//,/ }; do
    PORT=$port pm2 start python-service/face_service.py \
        --name "python-service-$i" \
        --interpreter "$VENV_PYTHON" \
        --log python-service.log \
        --time
    i=$((i+1))
done

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
echo "  pm2 logs labeler"
echo ""
echo "Stop services:"
echo "  pm2 stop all"
echo ""
