"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Card, PageHeader, PersonChip, Table, TableWrap, Td, Th } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLE_LABEL } from "@/lib/constants";
import { useApiMutation, useUsers } from "@/lib/queries";
import type { Role, User } from "@/types";

interface UserForm {
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  phone: string;
  job_title: string;
  commission_split: string;
  password: string;
  is_active: boolean;
}

function UserModal({ open, user, onClose }: { open: boolean; user: User | null; onClose: () => void }) {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UserForm>();

  useEffect(() => {
    if (!open) return;
    setError(null);
    reset({
      email: user?.email ?? "",
      first_name: user?.first_name ?? "",
      last_name: user?.last_name ?? "",
      role: user?.role ?? "salesperson",
      phone: user?.phone ?? "",
      job_title: user?.job_title ?? "",
      commission_split: user?.commission_split ?? "50",
      password: "",
      is_active: user?.is_active ?? true,
    });
  }, [open, user, reset]);

  const save = useApiMutation((v: UserForm) => {
    const body: Partial<UserForm> = { ...v };
    if (!body.password) delete body.password;
    return user
      ? api(`/users/${user.id}/`, { method: "PATCH", body })
      : api("/users/", { method: "POST", body });
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={user ? "Edit team member" : "Add team member"}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={handleSubmit(async (v) => {
              try {
                await save.mutateAsync(v);
                toast.success(user ? "User updated" : "User created");
                onClose();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : "Could not save user");
              }
            })}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field label="First name" required error={errors.first_name?.message}>
          <Input {...register("first_name", { required: "Required" })} />
        </Field>
        <Field label="Last name">
          <Input {...register("last_name")} />
        </Field>
        <Field label="Email" required className="sm:col-span-2" error={errors.email?.message}>
          <Input type="email" disabled={Boolean(user)} {...register("email", { required: "Required" })} />
        </Field>
        <Field label="Role">
          <Select {...register("role")}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Commission split (%)">
          <Input type="number" min={0} max={100} step="0.5" {...register("commission_split")} />
        </Field>
        <Field label="Job title">
          <Input {...register("job_title")} />
        </Field>
        <Field label="Phone">
          <Input {...register("phone")} />
        </Field>
        <Field
          label={user ? "New password" : "Password"}
          required={!user}
          hint={user ? "Leave blank to keep the current password" : "Minimum 8 characters"}
          className="sm:col-span-2"
          error={errors.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...register("password", { minLength: { value: 8, message: "At least 8 characters" } })} />
        </Field>
        {user && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" {...register("is_active")} /> Active (can sign in)
          </label>
        )}
      </div>
    </Modal>
  );
}

export default function SettingsPage() {
  const { user, isManager, refreshUser } = useAuth();
  const toast = useToast();
  const users = useUsers();
  const [editing, setEditing] = useState<User | null>(null);
  const [userModal, setUserModal] = useState(false);

  const profile = useForm<{ first_name: string; last_name: string; phone: string; job_title: string }>();
  useEffect(() => {
    if (user)
      profile.reset({
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        job_title: user.job_title,
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const pw = useForm<{ current_password: string; new_password: string; confirm: string }>();
  const [pwError, setPwError] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <PageHeader title="Profile & settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Profile">
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={profile.handleSubmit(async (v) => {
              try {
                await api("/auth/me/", { method: "PATCH", body: v });
                await refreshUser();
                toast.success("Profile saved");
              } catch (e) {
                toast.error(e instanceof ApiError ? e.message : "Could not save");
              }
            })}
          >
            <Field label="First name">
              <Input {...profile.register("first_name")} />
            </Field>
            <Field label="Last name">
              <Input {...profile.register("last_name")} />
            </Field>
            <Field label="Email">
              <Input value={user?.email ?? ""} disabled readOnly />
            </Field>
            <Field label="Role">
              <Input value={user ? ROLE_LABEL[user.role] : ""} disabled readOnly />
            </Field>
            <Field label="Phone">
              <Input {...profile.register("phone")} />
            </Field>
            <Field label="Job title">
              <Input {...profile.register("job_title")} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" loading={profile.formState.isSubmitting}>
                Save profile
              </Button>
            </div>
          </form>
        </Card>

        <Card title="Change password">
          <form
            className="space-y-3"
            onSubmit={pw.handleSubmit(async (v) => {
              setPwError(null);
              try {
                await api("/auth/change-password/", {
                  method: "POST",
                  body: { current_password: v.current_password, new_password: v.new_password },
                });
                pw.reset();
                toast.success("Password updated");
              } catch (e) {
                setPwError(e instanceof ApiError ? e.message : "Could not update password");
              }
            })}
          >
            <FormError message={pwError} />
            <Field label="Current password" error={pw.formState.errors.current_password?.message}>
              <Input type="password" autoComplete="current-password" {...pw.register("current_password", { required: "Required" })} />
            </Field>
            <Field label="New password" error={pw.formState.errors.new_password?.message}>
              <Input
                type="password"
                autoComplete="new-password"
                {...pw.register("new_password", { required: "Required", minLength: { value: 8, message: "At least 8 characters" } })}
              />
            </Field>
            <Field label="Confirm new password" error={pw.formState.errors.confirm?.message}>
              <Input
                type="password"
                autoComplete="new-password"
                {...pw.register("confirm", {
                  validate: (v) => v === pw.getValues("new_password") || "Passwords do not match",
                })}
              />
            </Field>
            <Button type="submit" loading={pw.formState.isSubmitting}>
              Update password
            </Button>
          </form>
        </Card>
      </div>

      {isManager && (
        <Card
          title="Team"
          padded={false}
          action={
            user?.role === "admin" && (
              <Button
                size="sm"
                variant="primary"
                icon={<Plus className="h-3.5 w-3.5" />}
                onClick={() => {
                  setEditing(null);
                  setUserModal(true);
                }}
              >
                Add member
              </Button>
            )
          }
        >
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th className="text-right">Split</Th>
                  <Th>Status</Th>
                  {user?.role === "admin" && <Th />}
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <PersonChip name={u.full_name} />
                    </Td>
                    <Td className="text-muted">{u.email}</Td>
                    <Td>{ROLE_LABEL[u.role]}</Td>
                    <Td className="tabular text-right">{u.commission_split ? `${Number(u.commission_split)}%` : "—"}</Td>
                    <Td>
                      <Badge tone={u.is_active === false ? "idle" : "ok"}>{u.is_active === false ? "Inactive" : "Active"}</Badge>
                    </Td>
                    {user?.role === "admin" && (
                      <Td className="text-right">
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(u);
                            setUserModal(true);
                          }}
                        >
                          Edit
                        </Button>
                      </Td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}

      <UserModal open={userModal} user={editing} onClose={() => setUserModal(false)} />
    </div>
  );
}
