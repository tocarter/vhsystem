import { useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
import { ALL_PERMISSIONS, PERMISSIONS, can, type Permission } from '~/lib/permissions'
import {
  ErrorNotice,
  Field,
  PageHeader,
  errorMessage,
} from '~/components/ui'
import { addRole, fetchRoles, removeRole, saveRole } from '~/server/functions/roles'

export const Route = createFileRoute('/_app/admin/roles')({
  beforeLoad: ({ context }) => {
    if (!can(context.viewer, 'roles.manage')) throw redirect({ to: '/admin' })
  },
  loader: () => fetchRoles(),
  component: RolesPage,
})

function RolesPage() {
  const roles = Route.useLoaderData()
  const router = useRouter()
  const [creating, setCreating] = useState(false)

  return (
    <div>
      <PageHeader
        title="Roles and permissions"
        description="Permissions are the unit of access. A role is a named bundle of them, so new roles never need code changes."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => setCreating((open) => !open)}
          >
            {creating ? 'Cancel' : 'New role'}
          </button>
        }
      />

      {creating ? (
        <NewRoleForm
          onDone={async () => {
            setCreating(false)
            await router.invalidate()
          }}
        />
      ) : null}

      <div className="space-y-4">
        {roles.map((role) => (
          <RoleCard key={role.id} role={role} />
        ))}
      </div>
    </div>
  )
}

type RoleSummary = Awaited<ReturnType<typeof fetchRoles>>[number]

function PermissionGrid({
  selected,
  onToggle,
}: {
  selected: Array<Permission>
  onToggle: (permission: Permission) => void
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {ALL_PERMISSIONS.map((permission) => (
        <label
          key={permission}
          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2.5 transition hover:bg-slate-50"
        >
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={selected.includes(permission)}
            onChange={() => onToggle(permission)}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800">
              {PERMISSIONS[permission]}
            </span>
            <span className="block font-mono text-xs text-slate-500">
              {permission}
            </span>
          </span>
        </label>
      ))}
    </div>
  )
}

function RoleCard({ role }: { role: RoleSummary }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(role.name)
  const [description, setDescription] = useState(role.description ?? '')
  const [permissions, setPermissions] = useState<Array<Permission>>(role.permissions)

  const save = useMutation({
    mutationFn: () =>
      saveRole({
        data: { roleId: role.id, name, description, permissions },
      }),
    onSuccess: async () => {
      setEditing(false)
      await router.invalidate()
    },
  })

  const destroy = useMutation({
    mutationFn: () => removeRole({ data: { roleId: role.id } }),
    onSuccess: () => router.invalidate(),
  })

  const toggle = (permission: Permission) =>
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
    )

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{role.name}</h2>
            {role.isSystem ? (
              <span className="badge bg-slate-100 text-slate-600">Built in</span>
            ) : null}
          </div>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{role.key}</p>
          {role.description ? (
            <p className="mt-2 text-sm text-slate-600">{role.description}</p>
          ) : null}
          <p className="mt-2 text-sm text-slate-500">
            {role.memberCount} {role.memberCount === 1 ? 'member' : 'members'} ·{' '}
            {role.permissions.length} permissions
          </p>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setEditing((open) => !open)}
          >
            {editing ? 'Cancel' : 'Edit permissions'}
          </button>
          {!role.isSystem ? (
            <button
              type="button"
              className="btn-danger"
              disabled={destroy.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete the "${role.name}" role? Its ${role.memberCount} member(s) move to the built-in Member role.`,
                  )
                ) {
                  destroy.mutate()
                }
              }}
            >
              Delete
            </button>
          ) : null}
        </div>
      </div>

      <ErrorNotice
        message={
          save.isError
            ? errorMessage(save.error)
            : destroy.isError
              ? errorMessage(destroy.error)
              : null
        }
      />

      {editing ? (
        <div className="mt-5 border-t border-slate-100 pt-5">
          {!role.isSystem ? (
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label="Description">
                <input
                  className="input"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </Field>
            </div>
          ) : null}

          <PermissionGrid selected={permissions} onToggle={toggle} />

          <button
            type="button"
            className="btn-primary mt-4"
            disabled={save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Saving…' : 'Save role'}
          </button>
        </div>
      ) : (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {role.permissions.length === 0 ? (
            <li className="text-sm text-slate-500">No permissions granted.</li>
          ) : (
            role.permissions.map((permission) => (
              <li
                key={permission}
                className="badge bg-slate-100 font-mono text-slate-600"
              >
                {permission}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  )
}

function NewRoleForm({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [permissions, setPermissions] = useState<Array<Permission>>([])

  const create = useMutation({
    mutationFn: () =>
      addRole({ data: { key, name, description, permissions } }),
    onSuccess: onDone,
  })

  return (
    <form
      className="card mb-6 p-5"
      onSubmit={(event) => {
        event.preventDefault()
        create.mutate()
      }}
    >
      <h2 className="text-base font-semibold text-slate-900">Create a role</h2>

      <ErrorNotice message={create.isError ? errorMessage(create.error) : null} />

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Field label="Key" required hint="Lowercase identifier, e.g. coordinator">
          <input
            className="input"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            placeholder="coordinator"
            required
          />
        </Field>
        <Field label="Name" required>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Coordinator"
            required
          />
        </Field>
        <Field label="Description">
          <input
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>

      <div className="mt-4">
        <PermissionGrid
          selected={permissions}
          onToggle={(permission) =>
            setPermissions((current) =>
              current.includes(permission)
                ? current.filter((entry) => entry !== permission)
                : [...current, permission],
            )
          }
        />
      </div>

      <button type="submit" className="btn-primary mt-4" disabled={create.isPending}>
        {create.isPending ? 'Creating…' : 'Create role'}
      </button>
    </form>
  )
}
