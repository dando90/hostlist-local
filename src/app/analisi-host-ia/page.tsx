import type { Metadata } from "next";
import HostAnalysisDashboard from "../../features/analysis/HostAnalysisDashboard";

export const metadata: Metadata = { title: "Analisi host IA" };

export default function HostAiAnalysisPage() {
  return <HostAnalysisDashboard mode="ai" />;
}
