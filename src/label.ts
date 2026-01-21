import { LabelerServer } from '@skyware/labeler';

import { DID, SIGNING_KEY } from './config.js';
import logger from './logger.js';

export const labelerServer = new LabelerServer({ did: DID, signingKey: SIGNING_KEY });

// Add DID document route for public resolution
labelerServer.app.get('/.well-known/did.json', async (request, reply) => {
  return {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: DID,
    service: [
      {
        id: '#atproto_labeler',
        type: 'AtprotoLabeler',
        serviceEndpoint: `https://bsky.app`,
      },
    ],
  };
});

/**
 * Apply labels to a post
 * @param postUri - The full AT-URI of the post (at://did/app.bsky.feed.post/rkey)
 * @param labelIdentifiers - Array of label identifiers to apply (e.g., ['trump', 'biden'])
 */
export const labelPost = async (postUri: string, labelIdentifiers: string[]): Promise<void> => {
  if (labelIdentifiers.length === 0) {
    logger.warn(`No labels to apply to ${postUri}`);
    return;
  }

  logger.info(`Applying ${labelIdentifiers.length} label(s) to ${postUri}: ${labelIdentifiers.join(', ')}`);

  try {
    for (const identifier of labelIdentifiers) {
      await labelerServer.createLabel({ uri: postUri, val: identifier });
      logger.info(`Successfully labeled ${postUri} with ${identifier}`);
    }
  } catch (error) {
    logger.error(`Error labeling post ${postUri}: ${error}`);
    throw error;
  }
};
