import { useState } from 'react'
import { applicationInputSchema } from '~/lib/validation'
import { ErrorNotice, Field, errorMessage } from '~/components/ui'

export type RegistrationFormState = {
  firstName: string
  lastName: string
  discordHandle: string
  phone: string
}

export function RegistrationForm({
  email,
  initial,
  submitting,
  error,
  submitLabel,
  onSubmit,
}: {
  email?: string | null
  initial?: Partial<RegistrationFormState>
  submitting: boolean
  error: unknown
  submitLabel: string
  onSubmit: (data: RegistrationFormState) => void
}) {
  const [form, setForm] = useState<RegistrationFormState>({
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    discordHandle: initial?.discordHandle ?? '',
    phone: initial?.phone ?? '',
  })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const update = (key: keyof RegistrationFormState) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }))

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = applicationInputSchema.safeParse(form)

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
    onSubmit(form)
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <ErrorNotice message={error ? errorMessage(error) : null} />

      {email ? (
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-500">
            Signed in with Google as
          </p>
          <p className="text-sm font-semibold text-slate-900">{email}</p>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" required error={fieldErrors.firstName}>
          <input
            className="input"
            value={form.firstName}
            onChange={(event) => update('firstName')(event.target.value)}
            autoComplete="given-name"
            required
          />
        </Field>
        <Field label="Last name" required error={fieldErrors.lastName}>
          <input
            className="input"
            value={form.lastName}
            onChange={(event) => update('lastName')(event.target.value)}
            autoComplete="family-name"
            required
          />
        </Field>
      </div>

      <Field
        label="Discord handle"
        required
        hint="For example nova.hart — this is how the team reaches you."
        error={fieldErrors.discordHandle}
      >
        <input
          className="input"
          value={form.discordHandle}
          onChange={(event) => update('discordHandle')(event.target.value)}
          placeholder="nova.hart"
          required
        />
      </Field>

      <Field
        label="Phone number"
        hint="Optional. Only visible to administrators."
        error={fieldErrors.phone}
      >
        <input
          className="input"
          value={form.phone}
          onChange={(event) => update('phone')(event.target.value)}
          autoComplete="tel"
          inputMode="tel"
          placeholder="(555) 010-1234"
        />
      </Field>

      <button
        type="submit"
        className="btn-primary w-full py-3"
        disabled={submitting}
      >
        {submitting ? 'Submitting…' : submitLabel}
      </button>
    </form>
  )
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-5 w-5">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 6.68 9.14 4.75 12 4.75Z"
      />
    </svg>
  )
}
