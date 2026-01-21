import { AtpAgent } from '@atproto/api';
import 'dotenv/config';

const BSKY_IDENTIFIER = process.env.BSKY_IDENTIFIER ?? '';
const BSKY_PASSWORD = process.env.BSKY_PASSWORD ?? '';

if (!BSKY_IDENTIFIER || !BSKY_PASSWORD) {
  console.error('Missing BSKY_IDENTIFIER or BSKY_PASSWORD in .env');
  process.exit(1);
}

const agent = new AtpAgent({ service: 'https://bsky.social' });

try {
  await agent.login({
    identifier: BSKY_IDENTIFIER,
    password: BSKY_PASSWORD,
  });

  console.log(`Logged in as ${agent.session?.handle} (${agent.session?.did})`);

  // Check if labeler service record exists
  try {
    const record = await agent.com.atproto.repo.getRecord({
      repo: agent.session!.did,
      collection: 'app.bsky.labeler.service',
      rkey: 'self',
    });
    console.log('Found labeler service record:', record.data);
  } catch (e) {
    console.log('No labeler service record found on this account.');
    process.exit(0);
  }

  // Confirm before deleting
  console.log('\nThis will remove the labeler service from your account.');
  console.log('Press Ctrl+C to cancel, or wait 5 seconds to proceed...');
  await new Promise((resolve) => setTimeout(resolve, 5000));

  await agent.com.atproto.repo.deleteRecord({
    repo: agent.session!.did,
    collection: 'app.bsky.labeler.service',
    rkey: 'self',
  });

  console.log('✓ Labeler service removed from account.');
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
