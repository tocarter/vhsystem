import { useMemo, useRef, useState } from 'react'
import { MAX_HOURS_PER_REQUEST } from '~/lib/hours'
import {
  ALLOWED_IMAGE_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  isAllowedImageType,
  requestInputSchema,
} from '~/lib/validation'
import type { PhotoAttachment } from './PhotoStrip'
import { ErrorNotice, Field, formatBytes } from './ui'

export type RequestFormValues = {
  serviceDate: string
  activity: string
  hours: string
  notes: string
}

export function RequestForm({
  initialValues,
  existingAttachments = [],
  submitLabel,
  pending,
  errorText,
  onSubmit,
}: {
  initialValues?: Partial<RequestFormValues>
  existingAttachments?: Array<PhotoAttachment>
  submitLabel: string
  pending: boolean
  errorText: string | null
  onSubmit: (formData: FormData) => void
}) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const fileInput = useRef<HTMLInputElement>(null)

  const [values, setValues] = useState<RequestFormValues>({
    serviceDate: initialValues?.serviceDate ?? today,
    activity: initialValues?.activity ?? '',
    hours: initialValues?.hours ?? '',
    notes: initialValues?.notes ?? '',
  })
  const [files, setFiles] = useState<Array<File>>([])
  const [removedIds, setRemovedIds] = useState<Array<string>>([])
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [fileError, setFileError] = useState<string | null>(null)

  const keptExisting = existingAttachments.filter(
    (attachment) => !removedIds.includes(attachment.id),
  )
  const totalPhotos = keptExisting.length + files.length

  const previews = useMemo(
    () => files.map((file) => ({ file, url: URL.createObjectURL(file) })),
    [files],
  )

  const update = (key: keyof RequestFormValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return
    const accepted: Array<File> = []
    let error: string | null = null

    for (const file of Array.from(incoming)) {
      if (!isAllowedImageType(file.type)) {
        error = 'Only JPEG, PNG, WebP or HEIC images are accepted.'
        continue
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        error = `${file.name} is larger than 8 MB.`
        continue
      }
      if (keptExisting.length + files.length + accepted.length >= MAX_ATTACHMENTS) {
        error = `You can attach at most ${MAX_ATTACHMENTS} photos.`
        break
      }
      accepted.push(file)
    }

    setFileError(error)
    if (accepted.length > 0) setFiles((current) => [...current, ...accepted])
    if (fileInput.current) fileInput.current.value = ''
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault()

    const parsed = requestInputSchema().safeParse({
      serviceDate: values.serviceDate,
      activity: values.activity,
      hours: values.hours === '' ? Number.NaN : Number(values.hours),
      notes: values.notes,
    })

    if (!parsed.success) {
      const errors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        if (typeof key === 'string' && !errors[key]) errors[key] = issue.message
      }
      setFieldErrors(errors)
      return
    }

    setFieldErrors({})

    const formData = new FormData()
    formData.set('serviceDate', parsed.data.serviceDate)
    formData.set('activity', parsed.data.activity)
    formData.set('hours', String(parsed.data.hours))
    formData.set('notes', parsed.data.notes ?? '')
    for (const file of files) formData.append('photos', file)
    for (const id of removedIds) formData.append('removeAttachmentIds', id)

    onSubmit(formData)
  }

  return (
    <form onSubmit={submit} className="card space-y-5 p-6">
      <ErrorNotice message={errorText} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Service date" required error={fieldErrors.serviceDate}>
          <input
            type="date"
            className="input"
            max={today}
            value={values.serviceDate}
            onChange={(event) => update('serviceDate', event.target.value)}
            required
          />
        </Field>

        <Field
          label="Hours volunteered"
          required
          hint={`Up to ${MAX_HOURS_PER_REQUEST} hours, in quarter-hour steps.`}
          error={fieldErrors.hours}
        >
          <input
            type="number"
            className="input"
            min="0.25"
            max={MAX_HOURS_PER_REQUEST}
            step="0.25"
            inputMode="decimal"
            value={values.hours}
            onChange={(event) => update('hours', event.target.value)}
            placeholder="2.5"
            required
          />
        </Field>
      </div>

      <Field
        label="What did you do?"
        required
        hint="Describe the work clearly enough that a reviewer can recognise it."
        error={fieldErrors.activity}
      >
        <textarea
          className="input min-h-24 resize-y"
          value={values.activity}
          onChange={(event) => update('activity', event.target.value)}
          placeholder="Set up and ran the registration desk at the community food drive."
          required
        />
      </Field>

      <Field
        label="Notes for the reviewer"
        hint="Optional. Anything that helps the reviewer understand your submission."
        error={fieldErrors.notes}
      >
        <textarea
          className="input min-h-20 resize-y"
          value={values.notes}
          onChange={(event) => update('notes', event.target.value)}
        />
      </Field>

      <div>
        <span className="label">
          Proof photos
          <span className="ml-2 font-normal text-slate-500">
            {totalPhotos} of {MAX_ATTACHMENTS}
          </span>
        </span>

        {keptExisting.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2.5">
            {keptExisting.map((attachment) => (
              <li key={attachment.id} className="relative">
                <img
                  src={attachment.url}
                  alt={attachment.fileName}
                  className="h-24 w-24 rounded-xl border border-slate-200 bg-slate-100 object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setRemovedIds((current) => [...current, attachment.id])
                  }
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow"
                  aria-label={`Remove ${attachment.fileName}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {previews.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2.5">
            {previews.map((preview, index) => (
              <li key={preview.url} className="relative">
                <img
                  src={preview.url}
                  alt={preview.file.name}
                  className="h-24 w-24 rounded-xl border border-brand-200 object-cover"
                />
                <span className="mt-1 block max-w-24 truncate text-[11px] text-slate-500">
                  {formatBytes(preview.file.size)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((current) => current.filter((_, i) => i !== index))
                  }
                  className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow"
                  aria-label={`Remove ${preview.file.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          ref={fileInput}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          multiple
          className="mt-3 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200"
          onChange={(event) => addFiles(event.target.files)}
          disabled={totalPhotos >= MAX_ATTACHMENTS}
        />
        {fileError ? (
          <p className="mt-1.5 text-xs text-red-600">{fileError}</p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-500">
            JPEG, PNG, WebP or HEIC. Up to 8 MB each.
          </p>
        )}
      </div>

      <button type="submit" className="btn-primary w-full py-3" disabled={pending}>
        {pending ? 'Submitting…' : submitLabel}
      </button>
    </form>
  )
}
