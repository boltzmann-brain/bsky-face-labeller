import { Label } from './types.js';

// Face detection labels - one label per recognized public figure
export const LABELS: Label[] = [
  {
    rkey: '',
    identifier: 'trump',
    locales: [
      {
        lang: 'en',
        name: 'Donald Trump',
        description: 'This post contains an image of Donald Trump',
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
