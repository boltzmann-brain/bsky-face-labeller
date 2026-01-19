# Reference Face Images

This directory contains reference images used for face recognition.

## Structure

Each subdirectory represents a person to recognize:
- Directory name should match the label identifier in `src/constants.ts`
- Include 5-10 clear, high-quality photos of the person's face
- Vary angles, expressions, and lighting conditions
- Name files sequentially: `001.jpg`, `002.jpg`, etc.

## Current Setup

- `trump/` - Donald Trump reference images (add your images here)

## Adding a New Person

1. Create a new directory: `reference-faces/person-name/`
   ```bash
   mkdir reference-faces/biden
   ```

2. Add 5-10 clear face photos to the directory
   - Photos should be in JPG or PNG format
   - Name them sequentially: `001.jpg`, `002.jpg`, etc.

3. Update `src/constants.ts` with the new label:
   ```typescript
   {
     rkey: '',
     identifier: 'biden',  // Must match directory name
     locales: [
       {
         lang: 'en',
         name: 'Joe Biden',
         description: 'This post contains an image of Joe Biden',
       },
     ],
   }
   ```

4. Run the label setup script:
   ```bash
   npm run set-labels
   ```

5. Restart the labeler to load the new reference faces

## Image Guidelines

### Quality Requirements
- **Format**: JPG or PNG
- **Resolution**: At least 640x640 pixels
- **Face visibility**: Clear, well-lit, minimal occlusion
- **Focus**: Face should be in focus and clearly visible

### Variety
For best recognition accuracy, include photos with:
- Different angles (straight-on, 3/4 view, profile)
- Different expressions (neutral, smiling, serious)
- Different lighting conditions (indoor, outdoor, studio)
- Different ages (if available) to account for appearance changes
- Different settings/backgrounds

### What to Avoid
- Blurry or low-resolution images
- Heavy shadows or poor lighting
- Sunglasses or face coverings
- Extreme angles or partial faces
- Heavy image compression artifacts

## Testing Reference Images

After adding new reference images, you can test if they work by:

1. Check the logs when the labeler starts - it should show:
   ```
   Loading X reference images for person-name...
   Loaded Y face descriptors for person-name
   ```

2. If `Y` is less than `X`, some images didn't have detectable faces
   - Review those images and ensure faces are clearly visible
   - Consider replacing low-quality images

3. Test with sample posts containing that person's image
   - Monitor logs for face detection results
   - Adjust confidence threshold in `.env` if needed

## Troubleshooting

### No faces detected in reference images
- Ensure images are high quality and faces are clearly visible
- Try using different photos with better lighting
- Check that images are in the correct format (JPG/PNG)

### False positives (detecting wrong person)
- Add more reference images for better accuracy
- Increase confidence threshold in `.env`:
  ```
  FACE_CONFIDENCE_THRESHOLD=0.7  # Higher = more strict
  ```

### False negatives (missing correct person)
- Add more varied reference images
- Lower confidence threshold in `.env`:
  ```
  FACE_CONFIDENCE_THRESHOLD=0.5  # Lower = more permissive
  ```
- Ensure reference images include similar angles/lighting as target images

## Privacy and Legal Considerations

- Only use images of public figures
- Ensure you have the right to use the reference images
- Consider fair use and privacy laws in your jurisdiction
- Don't use images of private individuals without consent
