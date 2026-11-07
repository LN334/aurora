/**
 * The Aurora mark: the two legs of the capital A that the app icon and the tray
 * draw, without the crossbar.
 *
 * The title bar used to put three aurora arcs here. At 21 px they read as a wifi
 * glyph, and they did not match the letter on the icon and the tray, so the brand
 * looked like two products sharing a window. The geometry is lifted from
 * scripts/make-icons.mjs (512 px design coordinates scaled into a 24 grid), so the
 * letter cannot drift away from the icon again - and leaving the crossbar off is a
 * deliberate difference: a bare peak reads cleaner at UI sizes than a three-stroke
 * A whose crossbar fills in, and it matches the icon silhouette apart from that bar.
 *
 * The gradient is fixed on purpose: the interface recolours itself from the cover
 * art, and a logo that changes colour with every album stops being a logo.
 */
const STROKE = 3

export function BrandMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="brand-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        {/* Single instance in the app; a duplicate id would resolve to this one. */}
        <linearGradient
          id="aurora-brand"
          gradientUnits="userSpaceOnUse"
          x1="3.6"
          y1="2.6"
          x2="20.4"
          y2="21.4"
        >
          <stop offset="0" stopColor="#2ad9c8" />
          <stop offset="0.42" stopColor="#36aef3" />
          <stop offset="1" stopColor="#8f5cf0" />
        </linearGradient>
      </defs>
      <g stroke="url(#aurora-brand)" strokeWidth={STROKE} strokeLinecap="round">
        <path d="M5.8 20.95 12 3.05" />
        <path d="M18.2 20.95 12 3.05" />
      </g>
    </svg>
  )
}
