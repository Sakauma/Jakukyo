import names from './flowerNames.json';

// Public f1–f8 identities are also used by saves, replay events and scoring.
// Translate only at display time; do not renumber a flower for presentation.
export const flowerName = (code: string) => names[Number(code.slice(1)) - 1] ?? '花';
