import results from "@/data/results.json";
import Dashboard, { type Results } from "@/components/Dashboard";

export const metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return <Dashboard data={results as Results} />;
}
