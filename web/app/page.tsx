export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-3xl font-semibold">Hack the Water Graph</h1>
        <p className="mt-2 opacity-70">Sewer renewal decisions for the Jan de Jonghstraat catchment.</p>
        <a href="/AGV-Hackathon/dashboard/" className="mt-6 inline-block rounded-xl bg-blue-700 px-5 py-3 font-semibold text-white">Open the dashboard →</a>
      </div>
    </main>
  );
}
