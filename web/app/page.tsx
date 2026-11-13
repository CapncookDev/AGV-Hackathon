// The site opens on the pitch slides; the last slide links to the live demo with its tutorial.
const DECK = "/AGV-Hackathon/dashboard/pitch/";

export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <meta httpEquiv="refresh" content={`0; url=${DECK}`} />
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Hack the Water Graph</h1>
        <p className="mt-2 opacity-70">Opening the pitch…</p>
        <a href={DECK} className="mt-6 inline-block rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white">Go to the slides →</a>
      </div>
    </main>
  );
}
