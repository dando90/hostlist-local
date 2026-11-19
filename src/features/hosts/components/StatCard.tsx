export function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <div className="card">
      <span>{label}</span>
      <strong>{value == null ? "—" : value.toLocaleString("it-IT")}</strong>
    </div>
  );
}
