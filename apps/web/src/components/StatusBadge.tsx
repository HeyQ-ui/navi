export function StatusBadge({ status }: { status: string }) {
  if (status === 'verified') return null
  return <span className="chip border-warn/40 bg-warn-soft text-warn">待核实</span>
}
