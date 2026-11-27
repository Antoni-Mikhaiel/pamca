/**
 * Server-side include for the shared header/footer. Pages ship an empty
 * `<div id="header-placeholder"></div>` / `<div id="footer-placeholder"></div>`;
 * this fills them so the navigation and footer links are in the delivered HTML
 * (crawlable, no extra fetch, no layout shift). Used by the build
 * (scripts/build-static.ts), the dev server, and the server-rendered pages.
 * public/shared-scripts.js still fetches a partial only when its placeholder is
 * empty, so a page that skipped inlining keeps working.
 */
export type PartialReader = (name: "header" | "footer") => Promise<string>;

const SLOTS = [
  { name: "header", empty: '<div id="header-placeholder"></div>' },
  { name: "footer", empty: '<div id="footer-placeholder"></div>' },
] as const;

export async function inlinePartials(html: string, read: PartialReader): Promise<string> {
  let out = html;
  for (const slot of SLOTS) {
    if (!out.includes(slot.empty)) continue;
    const partial = (await read(slot.name)).trim();
    const filled = slot.empty.replace("></div>", `>\n${partial}\n</div>`);
    out = out.replace(slot.empty, () => filled);
  }
  return out;
}
