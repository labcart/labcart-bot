/**
 * Image Generation Profiles
 *
 * Defines reusable image generation configurations that specify:
 * - Model, size, quality, style parameters for DALL-E
 * - Prompt context/instructions that get injected into Turn 2
 *
 * Profiles are referenced by brains via imageGen.profile field.
 * This separates concerns: brains define personality, profiles define image generation style.
 */

module.exports = {
  /**
   * TOONR 2D Cartoon Style
   * Clean, polished 2D cartoon illustrations with flat colors and smooth linework
   * Style inspired by modern editorial cartoons and webcomics
   */
  'toonr-2d-cartoon': {
    model: 'dall-e-3',
    size: '1024x1024',
    quality: 'standard',
    style: 'natural', // Natural style avoids photorealistic tendencies

    // This context is prepended to every image generation request
    promptContext: `2D satirical meme/cartoon style. Clean but awkward, flat, bold, frozen intensity. Editorial cartoon exaggeration with Flash-era stiffness and internet meme tension. Lo-fi, emotionally weird, built for satire. Avoid polished or commercial animation styles (Futurama, Simpsons, etc).

COLORS: Flat solid colors only. No gradients, shading, texture, lighting effects, shadows, or rendered depth. Semi-naturalistic oversaturated skin tones. Simple vivid colors for clothing/objects. High contrast against thick black outlines.

LINEWORK: Thick solid black outlines on all elements (faces, bodies, props, backgrounds). Consistent smooth lines with slight wonkiness/uneven curves allowed. No variable stroke width or sketchiness. Minimal black interior lines for facial creases.

CHARACTERS: Heads slightly larger than realistic. Hyper-exaggerated expressions frozen mid-emotion: wide bean-shaped eyes with tiny pupils, warped off-center mouths, raised/furrowed eyebrows. Expressions feel captured in an instant, like a snapshot of peak emotion. Retain core emotion but exaggerate awkwardly. Simplified strange nose/mouth shapes (triangle, curved blob, awkward line). Embrace asymmetry. Retain recognizable likeness via key features (face shape, eye structure, hairstyle, expression style). Simplified bodies: basic posture, minimal anatomical detail, simple hands if shown.

POSES: Front-facing or stiff 3/4 view. Awkward, frozen, static poses. No action or cinematic movement. Body language frozen mid-reaction, emotionally stuck in place. Center figures. Cropped framing okay. Rigid unexpressive posture if full-body.

BACKGROUNDS: Flat-color minimal backgrounds in neutral/muted tones (light gray, beige, soft blue). Same flat-color black-outline style. No perspective rendering, depth cues, or lighting effects.

TONE: Internet meme culture, lo-fi reaction art, editorial satire. Characters emotionally frozen mid-moment (surprised, confused, dumbfounded, mid-breakdown). Slight imperfections in proportion/posture/symmetry desirable. Clean vector art with offbeat awkward soul.

Create this image:`
  },

  /**
   * Default / Realistic Photo Style
   * High-quality photorealistic images
   */
  'realistic-photo': {
    model: 'dall-e-3',
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid',
    promptContext: `Generate a high-quality, photorealistic image with natural lighting and realistic details.`
  },

  /**
   * Artistic Painting Style
   * Oil painting / artistic illustration style
   */
  'artistic-painting': {
    model: 'dall-e-3',
    size: '1024x1024',
    quality: 'standard',
    style: 'natural',
    promptContext: `Create an artistic illustration in the style of a traditional painting (oil, watercolor, or acrylic). Use visible brush strokes, artistic color choices, and painterly techniques. Avoid photorealism.`
  }
};
