import { useState } from 'react'
import { classNames, formatBytes } from './ui'

export type PhotoAttachment = {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
  url: string
}

/**
 * Evidence photos are fetched through the authorized download route, so the
 * browser sends the session cookie and the server re-checks access per image.
 */
export function PhotoStrip({
  attachments,
  className,
}: {
  attachments: Array<PhotoAttachment>
  className?: string
}) {
  const [active, setActive] = useState<PhotoAttachment | null>(null)

  if (attachments.length === 0) return null

  return (
    <div className={className}>
      <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        Proof ({attachments.length})
      </p>
      <ul className="flex flex-wrap gap-2.5">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              onClick={() => setActive(attachment)}
              className="group block overflow-hidden rounded-xl border border-slate-200 transition hover:border-brand-400"
              title={`${attachment.fileName} · ${formatBytes(attachment.sizeBytes)}`}
            >
              <img
                src={attachment.url}
                alt={attachment.fileName}
                loading="lazy"
                className="h-24 w-24 bg-slate-100 object-cover transition group-hover:scale-105"
              />
            </button>
          </li>
        ))}
      </ul>

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={active.fileName}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className={classNames('max-h-full w-full max-w-3xl')}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4 text-white">
              <p className="truncate text-sm font-medium">{active.fileName}</p>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium hover:bg-white/20"
              >
                Close
              </button>
            </div>
            <img
              src={active.url}
              alt={active.fileName}
              className="max-h-[75vh] w-full rounded-xl bg-slate-900 object-contain"
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
