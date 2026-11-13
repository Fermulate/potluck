import { t } from '@potluck/i18n'
import { useMemo } from 'react'
import { encode } from 'uqr'

/** SVG path of every dark module except the three finder patterns, one unit per module. */
function modulesPath(data: boolean[][], skip: (x: number, y: number) => boolean): string {
  let d = ''
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark && !skip(x, y)) d += `M${x} ${y}h1v1h-1z`
    }),
  )
  return d
}

/**
 * The invite link as a QR code, for inviting someone standing next to you. Ink on white in
 * both themes (scanners want the contrast), with rounded finder eyes as the only flourish.
 */
export function InviteQr({ url, groupName }: { url: string; groupName: string }) {
  const qr = useMemo(() => encode(url, { ecc: 'M', border: 0 }), [url])
  const n = qr.size
  const eyes = [
    [0, 0],
    [n - 7, 0],
    [0, n - 7],
  ] as const
  const inEye = (x: number, y: number) =>
    eyes.some(([ex, ey]) => x >= ex && x < ex + 7 && y >= ey && y < ey + 7)
  const quiet = 2
  const box = n + quiet * 2

  return (
    <figure className="grid justify-items-center gap-3">
      <div className="rounded-[1.25rem] bg-white p-4 shadow-raised">
        <svg
          role="img"
          aria-label={t('invites.qr.label', { group: groupName })}
          viewBox={`${-quiet} ${-quiet} ${box} ${box}`}
          className="size-56 sm:size-60"
          shapeRendering="crispEdges"
        >
          <path d={modulesPath(qr.data, inEye)} fill="#1d1a16" />
          {eyes.map(([x, y]) => (
            <g key={`${x}-${y}`} shapeRendering="geometricPrecision">
              <rect
                x={x + 0.5}
                y={y + 0.5}
                width={6}
                height={6}
                rx={1.6}
                fill="none"
                stroke="#1d1a16"
                strokeWidth={1}
              />
              <rect x={x + 2} y={y + 2} width={3} height={3} rx={0.9} fill="#1d1a16" />
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="max-w-xs text-center text-sm text-mute">
        {t('invites.qr.hint')}
      </figcaption>
    </figure>
  )
}
