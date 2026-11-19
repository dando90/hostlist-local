import HostAnalysisDashboard from "../../features/analysis/HostAnalysisDashboard";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Analisi host" };

export default function HostAnalysisPage() {
  return <HostAnalysisDashboard />;
}
