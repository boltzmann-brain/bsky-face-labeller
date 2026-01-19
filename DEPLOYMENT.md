# VPS Deployment Guide

This guide will help you deploy the Face Detection Labeler on a VPS (DigitalOcean, Linode, Vultr, AWS, etc.).

## Prerequisites

### Server Requirements
- **OS**: Ubuntu 22.04 LTS (recommended) or Ubuntu 20.04
- **RAM**: 4GB minimum (face detection is memory-intensive)
- **CPU**: 2+ cores (face detection is CPU-intensive)
- **Storage**: 10GB minimum
- **Network**: Stable internet connection

### What You'll Need
- SSH access to your VPS
- Your Bluesky labeler credentials:
  - DID (Decentralized Identifier)
  - Signing key
  - Bluesky handle
  - Bluesky app password

## Quick Start (5 minutes)

### 1. SSH into your VPS

```bash
ssh root@your-vps-ip
# Or: ssh username@your-vps-ip
```

### 2. Create a non-root user (if using root)

```bash
adduser labeler
usermod -aG sudo labeler
su - labeler
```

### 3. Run the deployment script

```bash
curl -fsSL https://raw.githubusercontent.com/boltzmann-brain/bsky-face-labeller/main/scripts/deploy.sh -o deploy.sh
chmod +x deploy.sh
./deploy.sh
```

The script will:
- ✓ Install Node.js 20.x
- ✓ Install Python 3 and build tools
- ✓ Install PM2 process manager
- ✓ Clone the repository
- ✓ Install all dependencies
- ✓ Create .env file template

### 4. Configure your credentials

Edit the `.env` file with your Bluesky labeler credentials:

```bash
cd bsky-face-labeller
nano .env
```

**Required settings:**
```env
DID=did:plc:YOUR_DID_HERE
SIGNING_KEY=your_signing_key_here
BSKY_IDENTIFIER=your.handle.bsky.social
BSKY_PASSWORD=your-app-password
```

**Optional settings:**
```env
# Start with PROCESS_ALL_POSTS=false to test
PROCESS_ALL_POSTS=false

# Adjust confidence threshold (0.0-1.0, lower = more matches)
FACE_CONFIDENCE_THRESHOLD=0.6

# Processing limits
MAX_IMAGE_PROCESSING_TIME=10000
MAX_QUEUE_SIZE=100
```

### 5. Start the services

```bash
./scripts/start-services.sh
```

This will:
- Start the Python face detection service on port 5001
- Start the Node.js labeler on port 4100
- Configure services to restart on server reboot

### 6. Verify it's working

```bash
./scripts/status.sh
```

You should see:
- ✓ Python service is healthy
- ✓ Labeler is running
- ✓ Both services showing in PM2 status

## Manual Deployment (Step by Step)

If you prefer to run commands manually:

### 1. Install Node.js

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Install Python and dependencies

```bash
sudo apt install -y python3 python3-pip python3-venv cmake build-essential git
```

### 3. Install PM2

```bash
sudo npm install -g pm2
```

### 4. Clone and setup

```bash
git clone https://github.com/boltzmann-brain/bsky-face-labeller.git
cd bsky-face-labeller
npm install
pip3 install --user -r python-service/requirements.txt
```

### 5. Configure

```bash
cp .env.example .env
nano .env
# Add your credentials
```

### 6. Start services

```bash
# Start Python service
pm2 start python-service/face_service.py --name python-service --interpreter python3

# Start labeler
pm2 start npm --name labeler -- start

# Save configuration
pm2 save

# Setup auto-start on reboot
pm2 startup
# Run the command that PM2 outputs
```

## Managing the Services

### View status
```bash
pm2 status
```

### View logs
```bash
pm2 logs                    # All logs
pm2 logs labeler           # Labeler only
pm2 logs python-service    # Python service only
```

### Restart services
```bash
pm2 restart all            # Restart both
pm2 restart labeler        # Restart labeler only
```

### Stop services
```bash
pm2 stop all
```

### Monitor resources
```bash
pm2 monit
```

## Updating the Application

When you push new code to GitHub:

```bash
cd bsky-face-labeller
./scripts/update.sh
```

This will:
1. Stop services
2. Pull latest code
3. Update dependencies
4. Restart services

## Firewall Configuration

If using UFW (Ubuntu Firewall):

```bash
# Allow SSH
sudo ufw allow 22/tcp

# Allow labeler ports (only if you need external access)
sudo ufw allow 4100/tcp
sudo ufw allow 4101/tcp

# Enable firewall
sudo ufw enable
```

**Note:** The Python service (port 5001) should NOT be exposed to the internet - it only needs to be accessible locally.

## Monitoring and Maintenance

### Check service health

```bash
./scripts/status.sh
```

### View metrics

```bash
curl http://localhost:4101/metrics
```

### Check Python service

```bash
curl http://localhost:5001/health
```

### Disk space

```bash
df -h
```

### Memory usage

```bash
free -h
```

### View processed posts

```bash
pm2 logs labeler | grep "Successfully labeled"
```

## Troubleshooting

### Services won't start

1. Check if ports are available:
```bash
sudo netstat -tulpn | grep -E '4100|4101|5001'
```

2. Check PM2 logs:
```bash
pm2 logs --err
```

3. Verify .env configuration:
```bash
cat .env
```

### Python service fails

1. Check if dependencies installed:
```bash
pip3 list | grep face-recognition
```

2. Test Python service manually:
```bash
cd python-service
python3 face_service.py
```

### Out of memory

1. Check memory usage:
```bash
free -h
pm2 monit
```

2. Reduce queue size in .env:
```env
MAX_QUEUE_SIZE=50
```

3. Enable swap if not already enabled:
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

### High CPU usage

Face detection is CPU-intensive. If CPU usage is too high:

1. Reduce processing by setting in .env:
```env
PROCESS_ALL_POSTS=false
```

2. Consider upgrading to more CPU cores

### Services not auto-starting on reboot

```bash
pm2 startup
# Run the command PM2 outputs
pm2 save
```

## Adding More Public Figures

1. Create directory for new person:
```bash
mkdir -p reference-faces/biden
```

2. Add 5-10 clear face photos (JPG format):
```bash
# Upload photos to reference-faces/biden/
```

3. Add label in `src/constants.ts`:
```typescript
{
  identifier: 'biden',
  locales: [{
    lang: 'en',
    name: 'Joe Biden',
    description: 'This post contains an image of Joe Biden'
  }]
}
```

4. Publish the label:
```bash
npm run set-labels
```

5. Restart services:
```bash
pm2 restart all
```

## Recommended VPS Providers

### DigitalOcean ($24/month)
- Droplet: 4GB RAM, 2 vCPUs
- Easy setup, good documentation
- [Sign up](https://www.digitalocean.com/)

### Linode ($24/month)
- Linode: 4GB RAM, 2 vCPUs
- Good performance, reliable
- [Sign up](https://www.linode.com/)

### Vultr ($24/month)
- Cloud Compute: 4GB RAM, 2 vCPUs
- Multiple locations worldwide
- [Sign up](https://www.vultr.com/)

### AWS EC2 (~$30/month)
- t3.medium: 4GB RAM, 2 vCPUs
- More configuration options
- [AWS Console](https://aws.amazon.com/ec2/)

## Security Recommendations

1. **Use SSH keys instead of passwords**
```bash
ssh-copy-id username@your-vps-ip
```

2. **Disable root login**
```bash
sudo nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
sudo systemctl restart sshd
```

3. **Keep system updated**
```bash
sudo apt update && sudo apt upgrade -y
```

4. **Enable automatic security updates**
```bash
sudo apt install unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

5. **Use a firewall**
```bash
sudo ufw enable
sudo ufw allow 22/tcp
```

## Support

For issues or questions:
- GitHub Issues: https://github.com/boltzmann-brain/bsky-face-labeller/issues
- Check logs: `pm2 logs`
- Run status check: `./scripts/status.sh`
