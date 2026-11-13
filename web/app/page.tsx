import Link from "next/link";
import { site } from "@/site.config";

const cards = [
  { href: "/dashboard", title: "Dashboard", text: "Interactive demo: rank interventions as the CO₂ shadow price changes." },
  { href: "/deck", title: "Pitch deck", text: "The slides from the final pitch." },
  { href: "/video", title: "Video", text: "Recorded demo walkthrough." },
];

export default function Home() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold">{site.title}</h1>
        <p className="mt-2 opacity-70">{site.tagline}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="rounded-lg border border-black/10 p-5 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/5"
          >
            <h2 className="font-medium">{c.title}</h2>
            <p className="mt-1 text-sm opacity-70">{c.text}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
