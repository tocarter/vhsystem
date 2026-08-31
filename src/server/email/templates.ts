import { formatHours } from '~/lib/hours'

export type EmailContent = {
  subject: string
  text: string
  html: string
}

export type EmailBrand = {
  orgName: string
  appOrigin: string
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function layout(brand: EmailBrand, heading: string, blocks: Array<string>): string {
  const body = blocks
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155">${block}</p>`,
    )
    .join('')

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;padding:32px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">${escapeHtml(brand.orgName)}</p>
      <h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:#0f172a">${escapeHtml(heading)}</h1>
      ${body}
    </div>
  </body>
</html>`
}

function button(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(label)}</a>`
}

export function hoursApprovedEmail(input: {
  brand: EmailBrand
  memberName: string
  minutes: number
  serviceDate: string
  activity: string
  totalMinutes: number
  verificationId: string
}): EmailContent {
  const hours = formatHours(input.minutes)
  const total = formatHours(input.totalMinutes)
  const verifyUrl = `${input.brand.appOrigin}/verify/${input.verificationId}`

  const subject = `${hours} volunteer hours approved`

  const text = [
    `Hi ${input.memberName},`,
    ``,
    `${hours} volunteer hours have been awarded to you by ${input.brand.orgName}.`,
    ``,
    `Service date: ${input.serviceDate}`,
    `Activity: ${input.activity}`,
    `Hours awarded: ${hours}`,
    `Your total approved hours: ${total}`,
    ``,
    `You can show this to your school to receive credit for your volunteer hours.`,
    `Download a signed certificate from your dashboard: ${input.brand.appOrigin}/dashboard`,
    ``,
    `Your school can confirm these hours independently at:`,
    `${verifyUrl}`,
    `Verification ID: ${input.verificationId}`,
  ].join('\n')

  const html = layout(input.brand, `${hours} volunteer hours approved`, [
    `Hi ${escapeHtml(input.memberName)},`,
    `<strong>${escapeHtml(hours)} volunteer hours</strong> have been awarded to you by ${escapeHtml(input.brand.orgName)}. You can show this to your school to receive credit for your volunteer hours.`,
    `<strong>Service date:</strong> ${escapeHtml(input.serviceDate)}<br>
     <strong>Activity:</strong> ${escapeHtml(input.activity)}<br>
     <strong>Hours awarded:</strong> ${escapeHtml(hours)}<br>
     <strong>Total approved hours:</strong> ${escapeHtml(total)}`,
    button(`${input.brand.appOrigin}/dashboard`, 'Download certificate'),
    `Your school can confirm these hours independently at <a href="${escapeHtml(verifyUrl)}">${escapeHtml(verifyUrl)}</a> using verification ID <strong>${escapeHtml(input.verificationId)}</strong>.`,
  ])

  return { subject, text, html }
}

export function requestDeclinedEmail(input: {
  brand: EmailBrand
  memberName: string
  serviceDate: string
  activity: string
  reviewNote: string | null
  changesRequested: boolean
}): EmailContent {
  const heading = input.changesRequested
    ? 'More detail needed on your hours'
    : 'Volunteer hour request declined'

  const explanation = input.changesRequested
    ? 'An administrator asked for more information before these hours can be approved. Update your request and submit it again.'
    : 'An administrator reviewed your request and was not able to approve it.'

  const note = input.reviewNote?.trim()

  const text = [
    `Hi ${input.memberName},`,
    ``,
    explanation,
    ``,
    `Service date: ${input.serviceDate}`,
    `Activity: ${input.activity}`,
    note ? `\nReviewer note: ${note}` : '',
    ``,
    `View the request: ${input.brand.appOrigin}/dashboard`,
  ]
    .filter(Boolean)
    .join('\n')

  const html = layout(input.brand, heading, [
    `Hi ${escapeHtml(input.memberName)},`,
    escapeHtml(explanation),
    `<strong>Service date:</strong> ${escapeHtml(input.serviceDate)}<br>
     <strong>Activity:</strong> ${escapeHtml(input.activity)}`,
    ...(note ? [`<em>Reviewer note:</em> ${escapeHtml(note)}`] : []),
    button(`${input.brand.appOrigin}/dashboard`, 'View request'),
  ])

  return { subject: heading, text, html }
}

export function applicationApprovedEmail(input: {
  brand: EmailBrand
  memberName: string
}): EmailContent {
  const subject = `You are approved for ${input.brand.orgName}`

  const text = [
    `Hi ${input.memberName},`,
    ``,
    `Your membership has been approved. You can now submit volunteer hour requests and track your approved hours.`,
    ``,
    `Get started: ${input.brand.appOrigin}/dashboard`,
  ].join('\n')

  const html = layout(input.brand, 'Your membership is approved', [
    `Hi ${escapeHtml(input.memberName)},`,
    `Your membership has been approved. You can now submit volunteer hour requests and track your approved hours.`,
    button(`${input.brand.appOrigin}/dashboard`, 'Open your dashboard'),
  ])

  return { subject, text, html }
}

export function applicationDeclinedEmail(input: {
  brand: EmailBrand
  memberName: string
  decisionNote: string | null
}): EmailContent {
  const subject = 'Your membership request needs another look'
  const note = input.decisionNote?.trim()

  const text = [
    `Hi ${input.memberName},`,
    ``,
    `Your membership request was not approved this time. You can correct your details and submit a new request.`,
    note ? `\nReviewer note: ${note}` : '',
    ``,
    `Submit again: ${input.brand.appOrigin}/register`,
  ]
    .filter(Boolean)
    .join('\n')

  const html = layout(input.brand, subject, [
    `Hi ${escapeHtml(input.memberName)},`,
    `Your membership request was not approved this time. You can correct your details and submit a new request.`,
    ...(note ? [`<em>Reviewer note:</em> ${escapeHtml(note)}`] : []),
    button(`${input.brand.appOrigin}/register`, 'Submit a new request'),
  ])

  return { subject, text, html }
}

export function hoursAdjustedEmail(input: {
  brand: EmailBrand
  memberName: string
  minutes: number
  reason: string
  totalMinutes: number
}): EmailContent {
  const direction = input.minutes >= 0 ? 'added to' : 'removed from'
  const amount = formatHours(Math.abs(input.minutes))
  const subject = `${amount} volunteer hours ${direction} your record`

  const text = [
    `Hi ${input.memberName},`,
    ``,
    `An administrator posted a correction to your volunteer hour record.`,
    ``,
    `Adjustment: ${input.minutes >= 0 ? '+' : '-'}${amount} hours`,
    `Reason: ${input.reason}`,
    `Your total approved hours: ${formatHours(input.totalMinutes)}`,
    ``,
    `View your record: ${input.brand.appOrigin}/dashboard`,
  ].join('\n')

  const html = layout(input.brand, subject, [
    `Hi ${escapeHtml(input.memberName)},`,
    `An administrator posted a correction to your volunteer hour record.`,
    `<strong>Adjustment:</strong> ${input.minutes >= 0 ? '+' : '-'}${escapeHtml(amount)} hours<br>
     <strong>Reason:</strong> ${escapeHtml(input.reason)}<br>
     <strong>Total approved hours:</strong> ${escapeHtml(formatHours(input.totalMinutes))}`,
    button(`${input.brand.appOrigin}/dashboard`, 'View your record'),
  ])

  return { subject, text, html }
}
