"use client";

import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";

import { CompanySettingsCard } from "@/components/forms/company-settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FormError, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Card, PageHeader, PersonChip, Table, TableWrap, Td, Th, Ltr } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { api, tokens } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ROLES } from "@/lib/constants";
import { useApiMutation, useUsers } from "@/lib/queries";
import type { Role, User } from "@/types";
import { useTranslations } from "next-intl";
import { useEnums } from "@/lib/enums";
import { useApiErrors } from "@/lib/use-api-errors";

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
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
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
      title={user ? t("settings.editTeamMember") : t("settings.addTeamMember")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={handleSubmit(async (v) => {
              try {
                await save.mutateAsync(v);
                toast.success(user ? t("settings.userUpdated") : t("settings.userCreated"));
                onClose();
              } catch (e) {
                setError(errorText(e, t("settings.couldNotSaveUser")));
              }
            })}
          >
            {t("common.save")}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormError message={error} />
        </div>
        <Field label={t("common.firstName")} required error={errors.first_name?.message}>
          <Input {...register("first_name", { required: t("settings.required") })} />
        </Field>
        <Field label={t("common.lastName")}>
          <Input {...register("last_name")} />
        </Field>
        <Field label={t("common.email")} required className="sm:col-span-2" error={errors.email?.message}>
          <Input type="email" disabled={Boolean(user)} {...register("email", { required: t("settings.required") })} />
        </Field>
        <Field label={t("settings.role")}>
          <Select {...register("role")}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {enums.label("role", r)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("settings.commissionSplit")}>
          <Input type="number" min={0} max={100} step="0.5" {...register("commission_split")} />
        </Field>
        <Field label={t("settings.jobTitle")}>
          <Input {...register("job_title")} />
        </Field>
        <Field label={t("common.phone")}>
          <Input {...register("phone")} />
        </Field>
        <Field
          label={user ? t("common.newPassword") : t("common.password")}
          required={!user}
          hint={
            user
              ? t("settings.leaveBlankKeepCurrentPassword")
              : t("settings.minimumCharactersItTemporaryPerson")
          }
          className="sm:col-span-2"
          error={errors.password?.message}
        >
          <Input type="password" autoComplete="new-password" {...register("password", { minLength: { value: 8, message: t("common.atLeastCharacters") } })} />
        </Field>
        {user && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" {...register("is_active")} /> {" "}{t("settings.activeCanSign")}</label>
        )}
      </div>
    </Modal>
  );
}

export default function SettingsPage() {
  const enums = useEnums();
  const t = useTranslations();
  const { errorText } = useApiErrors();
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
      <PageHeader title={t("common.profileSettings")} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title={t("settings.profile")}>
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={profile.handleSubmit(async (v) => {
              try {
                await api("/auth/me/", { method: "PATCH", body: v });
                await refreshUser();
                toast.success(t("settings.profileSaved"));
              } catch (e) {
                toast.error(errorText(e, t("common.couldNotSave")));
              }
            })}
          >
            <Field label={t("common.firstName")}>
              <Input {...profile.register("first_name")} />
            </Field>
            <Field label={t("common.lastName")}>
              <Input {...profile.register("last_name")} />
            </Field>
            <Field label={t("common.email")}>
              <Input value={user?.email ?? ""} disabled readOnly />
            </Field>
            <Field label={t("settings.role")}>
              <Input value={user ? enums.label("role", user.role) : ""} disabled readOnly />
            </Field>
            <Field label={t("common.phone")}>
              <Input {...profile.register("phone")} />
            </Field>
            <Field label={t("settings.jobTitle")}>
              <Input {...profile.register("job_title")} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" variant="primary" loading={profile.formState.isSubmitting}>
                {t("settings.saveProfile")}</Button>
            </div>
          </form>
        </Card>

        <Card title={t("settings.changePassword")}>
          <form
            className="space-y-3"
            onSubmit={pw.handleSubmit(async (v) => {
              setPwError(null);
              try {
                // The server revokes every older token on a password change and returns a fresh pair for this session.
                const pair = await api<{ access: string; refresh: string }>("/auth/change-password/", {
                  method: "POST",
                  body: { current_password: v.current_password, new_password: v.new_password },
                });
                tokens.set(pair.access, pair.refresh);
                pw.reset();
                toast.success(t("settings.passwordUpdated"));
              } catch (e) {
                setPwError(errorText(e, t("settings.couldNotUpdatePassword")));
              }
            })}
          >
            <FormError message={pwError} />
            <Field label={t("settings.currentPassword")} error={pw.formState.errors.current_password?.message}>
              <Input type="password" autoComplete="current-password" {...pw.register("current_password", { required: t("settings.required") })} />
            </Field>
            <Field label={t("common.newPassword")} error={pw.formState.errors.new_password?.message}>
              <Input
                type="password"
                autoComplete="new-password"
                {...pw.register("new_password", { required: t("settings.required"), minLength: { value: 8, message: t("common.atLeastCharacters") } })}
              />
            </Field>
            <Field label={t("common.confirmNewPassword")} error={pw.formState.errors.confirm?.message}>
              <Input
                type="password"
                autoComplete="new-password"
                {...pw.register("confirm", {
                  validate: (v) => v === pw.getValues("new_password") || t("settings.passwordsDoNotMatch"),
                })}
              />
            </Field>
            <Button type="submit" loading={pw.formState.isSubmitting}>
              {t("settings.updatePassword")}</Button>
          </form>
        </Card>
      </div>

      {user?.role === "admin" && <CompanySettingsCard />}

      {isManager && (
        <Card
          title={t("settings.team")}
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
                {t("settings.addMember")}</Button>
            )
          }
        >
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>{t("settings.name")}</Th>
                  <Th>{t("common.email")}</Th>
                  <Th>{t("settings.role")}</Th>
                  {user?.role === "admin" && <Th className="text-end">{t("common.split")}</Th>}
                  <Th>{t("common.status")}</Th>
                  {user?.role === "admin" && <Th />}
                </tr>
              </thead>
              <tbody>
                {users.data?.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <PersonChip name={u.full_name} />
                    </Td>
                    <Td className="text-muted"><Ltr>{u.email}</Ltr></Td>
                    <Td>{enums.label("role", u.role)}</Td>
                    {user?.role === "admin" && (
                      <Td className="tabular text-end">{u.commission_split ? `${Number(u.commission_split)}%` : "—"}</Td>
                    )}
                    <Td>
                      <Badge tone={u.is_active === false ? "idle" : "ok"}>{u.is_active === false ? t("settings.inactive") : t("settings.active")}</Badge>
                    </Td>
                    {user?.role === "admin" && (
                      <Td className="text-end">
                        <Button
                          size="sm"
                          onClick={() => {
                            setEditing(u);
                            setUserModal(true);
                          }}
                        >
                          {t("common.edit")}</Button>
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
