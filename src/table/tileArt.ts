const urls = import.meta.glob('./assets/tiles/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const symbols = new Map<string, HTMLImageElement>();
let preparing: Promise<void> | undefined;

/** All artwork is bundled locally; preload once before the first texture is painted. */
export function prepareTileArt(): Promise<void> {
  preparing ??= Promise.all(Object.entries(urls).map(async ([path, url]) => {
    const image = new Image(); image.src = url; await image.decode();
    symbols.set(path.split('/').at(-1)!.replace('.png', ''), image);
  })).then(() => undefined);
  return preparing;
}

export function tileSymbol(code: string) { return symbols.get(code); }
