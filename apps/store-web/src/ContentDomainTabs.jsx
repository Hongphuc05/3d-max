export default function ContentDomainTabs({ value, onChange }) {
  return <div role="group" aria-label="Content domain" className="flex flex-wrap gap-2">
    {[["3dmodels", "Models"], ["3dscenes", "Scenes"]].map(([domain, label]) => <button key={domain} type="button" aria-pressed={value === domain} onClick={() => onChange(domain)} className={"rounded-md border px-4 py-2 text-sm " + (value === domain ? "border-accent bg-accent/10 text-accent" : "border-line text-mute hover:text-fg")}>{label}</button>)}
  </div>;
}
