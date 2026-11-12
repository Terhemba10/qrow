// The Qrow lockup (brand/export/logo.svg), inlined so it follows the text colour in light and dark.
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <svg viewBox="0 0 78 32" height={height} width={(height * 78) / 32} role="img" aria-label="Qrow" style={{ display: "block" }}
      dangerouslySetInnerHTML={{ __html: "<g transform=\"translate(-1.5 -1.4) scale(1.02)\"><path d=\"M17.09 24.16A10 10 0 1 1 24.16 17.09C25.7 20.3 27.4 24.5 28.3 27.1C28.8 28.6 27.6 29.4 26.2 28.5C23.6 26.8 20 25.4 17.09 24.16Z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.3\" stroke-linejoin=\"round\"/></g><g transform=\"translate(9.6 0)\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"3.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M21.2 24V9.9M21.2 16.2c0-4.4 2.7-6.3 6.9-6.3\"/><circle cx=\"38.1\" cy=\"16\" r=\"6.3\"/><path d=\"M48.2 9.9 52.6 22.3 57.3 11.4 62 22.3 66.4 9.9\"/></g>" }} />
  );
}
