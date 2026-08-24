export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="qsc-g" x1="4" y1="4" x2="44" y2="44">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      {/* shield */}
      <path
        d="M24 3l17 6v13c0 11.5-7.2 19.6-17 23C14.2 41.6 7 33.5 7 22V9l17-6z"
        fill="url(#qsc-g)"
      />
      {/* orbit */}
      <ellipse
        cx="24"
        cy="21"
        rx="10"
        ry="4.2"
        stroke="#ffffff"
        strokeOpacity="0.85"
        strokeWidth="1.6"
        transform="rotate(-18 24 21)"
      />
      {/* nucleus + photon */}
      <circle cx="24" cy="21" r="3" fill="#ffffff" />
      <circle cx="31.6" cy="16.8" r="1.8" fill="#ffffff" />
      {/* key stem */}
      <rect x="22.6" y="27" width="2.8" height="8" rx="1.4" fill="#ffffff" />
      <rect x="26.2" y="31.4" width="3.4" height="2.4" rx="1.2" fill="#ffffff" />
    </svg>
  );
}

export function Logo({
  size = "md",
  subtitle,
}: {
  size?: "sm" | "md" | "lg";
  subtitle?: string;
}) {
  const mark = size === "lg" ? "h-11 w-11" : size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const title = size === "lg" ? "text-xl" : size === "sm" ? "text-base" : "text-lg";
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark className={mark} />
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight ${title}`}>
          Quantum<span className="text-primary">Secure</span>
        </span>
        {subtitle && (
          <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-muted">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );
}
