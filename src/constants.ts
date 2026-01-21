import { Label } from './types.js';

// Face detection labels - one label per recognized public figure
export const LABELS: Label[] = [
  {
    rkey: '',
    identifier: 'trumpface',
    locales: [
      {
        lang: 'en',
        name: 'Contains Trump\'s Face',
        description: 'The image contains Trump\'s face',
      },
    ],
  },
  // Add more public figures here as needed
  // Example:
  // {
  //   rkey: '',
  //   identifier: 'biden',
  //   locales: [
  //     {
  //       lang: 'en',
  //       name: 'Joe Biden',
  //       description: 'This post contains an image of Joe Biden',
  //     },
  //   ],
  // },
];
