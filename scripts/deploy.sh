#!/bin/bash
set -e

echo "============================================"
echo "Face Detection Labeler VPS Deployment Script"
echo "============================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then
   echo -e "${RED}Please do not run as root. Run as a regular user with sudo privileges.${NC}"
   exit 1
fi

echo -e "${YELLOW}This script will:${NC}"
echo "  1. Install Node.js, Python, and required system dependencies"
echo "  2. Clone the repository (if not already cloned)"
echo "  3. Install application dependencies"
echo "  4. Set up PM2 process manager"
echo "  5. Configure services to start on boot"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Update system
echo -e "${GREEN}[1/7] Updating system packages...${NC}"
sudo apt update
sudo apt upgrade -y

# Install Node.js 20.x
echo -e "${GREEN}[2/7] Installing Node.js...${NC}"
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js already installed ($(node --version))"
fi

# Install Python and build tools
echo -e "${GREEN}[3/7] Installing Python and build dependencies...${NC}"
sudo apt install -y python3 python3-pip python3-venv cmake build-essential git

# Install PM2 globally
echo -e "${GREEN}[4/7] Installing PM2 process manager...${NC}"
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
else
    echo "PM2 already installed"
fi

# Clone repository if not in it
echo -e "${GREEN}[5/7] Setting up application...${NC}"
if [ ! -f "package.json" ]; then
    echo "Repository not found. Cloning..."
    read -p "Enter your GitHub username/repo (e.g., boltzmann-brain/bsky-face-labeller): " REPO
    git clone "https://github.com/${REPO}.git" bsky-face-labeller
    cd bsky-face-labeller
else
    echo "Already in repository directory"
fi

# Install Node.js dependencies
echo -e "${GREEN}[6/7] Installing Node.js dependencies...${NC}"
npm install

# Install Python dependencies
echo -e "${GREEN}[7/7] Installing Python dependencies...${NC}"
pip3 install --user -r python-service/requirements.txt

# Create .env file if it doesn't exist
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
    echo ""
    echo -e "${RED}IMPORTANT: You must configure .env before starting services!${NC}"
    echo "Edit .env and set the following:"
    echo "  - DID (your labeler DID)"
    echo "  - SIGNING_KEY (your signing key)"
    echo "  - BSKY_IDENTIFIER (your Bluesky handle)"
    echo "  - BSKY_PASSWORD (your Bluesky app password)"
    echo ""
    read -p "Press enter to edit .env now, or Ctrl+C to exit and edit later..."
    nano .env || vi .env || echo "Please edit .env manually"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}Installation Complete!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo ""
echo "1. Make sure .env is configured with your credentials"
echo ""
echo "2. Start the services:"
echo -e "   ${GREEN}./scripts/start-services.sh${NC}"
echo ""
echo "3. Check service status:"
echo -e "   ${GREEN}pm2 status${NC}"
echo -e "   ${GREEN}pm2 logs${NC}"
echo ""
echo "4. The services will automatically restart on system reboot"
echo ""
echo "5. Useful commands:"
echo -e "   ${GREEN}pm2 stop all${NC}           - Stop all services"
echo -e "   ${GREEN}pm2 restart all${NC}        - Restart all services"
echo -e "   ${GREEN}pm2 logs python-service${NC} - View Python service logs"
echo -e "   ${GREEN}pm2 logs labeler${NC}        - View labeler logs"
echo ""
