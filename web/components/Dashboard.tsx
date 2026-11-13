"use client";

import { useMemo, useState } from "react";

export type OptionName = "defer" | "reline" | "replace";

export type Option = {
  option: OptionName;
  cost_eur: number;
  gwp_kg: number;
  risk: number;
  function: number;
  life_years: number;
};

export type Asset = {
  id: string;
  type: string;
  material: string;
  diameter_mm: number;
  length_m: number;
  condition: number;
  options: Option[];
};

export type Results = { sample?: boolean; generated?: string; assets: Asset[] };

const colors: Record<OptionName, string> = {
  defer: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  reline: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  replace: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
};

const eur = (n: number) => `€${Math.round(n).toLocaleString("en-US")}`;

// score = cost + λ (€/t) × GWP (t). Options above the risk cap are excluded;
// if none pass, the lowest-risk option is chosen.
function choose(a: Asset, lambda: number, riskCap: number) {
  const scored = a.options.map((o) => ({ ...o, score: o.cost_eur + (lambda * o.gwp_kg) / 1000 }));
  const feasible = scored.filter((o) => o.risk <= riskCap);
  const pick = feasible.length
    ? feasible.reduce((b, o) => (o.score < b.score ? o : b))
    : scored.reduce((b, o) => (o.risk < b.risk ? o : b));
  return { pick, scored, feasible: feasible.length > 0 };
}

export default function Dashboard({ data }: { data: Results }) {
  const [lambda, setLambda] = useState(150);
  const [riskCap, setRiskCap] = useState(0.2);

  const rows = useMemo(
    () =>
      data.assets
        .map((a) => ({ a, ...choose(a, lambda, riskCap) }))
        .sort((x, y) => y.pick.score - x.pick.score),
    [data, lambda, riskCap],
  );

  const totals = rows.reduce(
    (t, r) => {
      t.cost += r.pick.cost_eur;
      t.gwp += r.pick.gwp_kg / 1000;
      t.count[r.pick.option] += 1;
      return t;
    },
    { cost: 0, gwp: 0, count: { defer: 0, reline: 0, replace: 0 } as Record<OptionName, number> },
  );

  return (
    <div className="space-y-6">
      {data.sample && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
          Sample data — layout only. Replace <code>web/data/results.json</code> with pipeline output.
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <label className="block text-sm">
          CO₂ shadow price: <strong>{eur(lambda)}/t</strong>
          <input type="range" min={0} max={500} step={10} value={lambda}
            onChange={(e) => setLambda(+e.target.value)} className="mt-2 w-full" />
        </label>
        <label className="block text-sm">
          Risk cap (PoF × CoF): <strong>{riskCap.toFixed(2)}</strong>
          <input type="range" min={0.02} max={0.6} step={0.01} value={riskCap}
            onChange={(e) => setRiskCap(+e.target.value)} className="mt-2 w-full" />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <Stat label="Total cost" value={eur(totals.cost)} />
        <Stat label="Embodied carbon" value={`${totals.gwp.toFixed(0)} t CO₂e`} />
        {(["defer", "reline", "replace"] as OptionName[]).map((o) => (
          <Stat key={o} label={o} value={String(totals.count[o])} />
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left opacity-60">
            <tr>
              <th className="py-2 pr-4">Asset</th>
              <th className="pr-4">Material</th>
              <th className="pr-4">Decision</th>
              <th className="pr-4 text-right">Cost</th>
              <th className="pr-4 text-right">GWP (t)</th>
              <th className="pr-4 text-right">Risk</th>
              <th className="pr-4 text-right">Score</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ a, pick, scored, feasible }) => (
              <tr key={a.id} className="border-t border-black/5 dark:border-white/10">
                <td className="py-2 pr-4 font-mono">{a.id}</td>
                <td className="pr-4">{a.material}, Ø{a.diameter_mm}</td>
                <td className="pr-4">
                  <span className={`rounded px-2 py-0.5 ${colors[pick.option]}`}>{pick.option}</span>
                </td>
                <td className="pr-4 text-right">{eur(pick.cost_eur)}</td>
                <td className="pr-4 text-right">{(pick.gwp_kg / 1000).toFixed(1)}</td>
                <td className="pr-4 text-right">{pick.risk.toFixed(3)}</td>
                <td className="pr-4 text-right">{eur(pick.score)}</td>
                <td className="text-xs opacity-70">
                  {!feasible
                    ? "no option under risk cap → lowest risk"
                    : scored
                        .filter((o) => o.option !== pick.option)
                        .map((o) =>
                          o.risk > riskCap ? `${o.option}: risk too high` : `${o.option}: +${eur(o.score - pick.score)}`,
                        )
                        .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-black/10 p-3 dark:border-white/10">
      <div className="text-xs capitalize opacity-60">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}
