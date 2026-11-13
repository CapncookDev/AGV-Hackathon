import { existsSync } from "node:fs";
import path from "node:path";
import { site } from "@/site.config";

export const metadata = { title: "Pitch deck" };

export default function DeckPage() {
  const hasDeck = existsSync(path.join(process.cwd(), "public", site.deckPdf));
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Pitch deck</h1>
      {hasDeck ? (
        <>
          <iframe src={site.deckPdf} className="h-[80vh] w-full rounded-lg border border-black/10" title="Pitch deck" />
          <a href={site.deckPdf} className="text-sm underline">Download PDF</a>
        </>
      ) : (
        <p className="opacity-70">Deck not uploaded yet. Export slides to PDF and save as <code>web/public/deck.pdf</code>.</p>
      )}
    </div>
  );
}
