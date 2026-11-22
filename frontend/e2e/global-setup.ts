import fs from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { LONG, ROLES, type Role } from "./helpers";

const AUTH_DIR = path.join(__dirname, ".auth");

/** Signs in once per role through the real API (the login is rate-limited to 20 a minute, so tests must not sign in again) and saves
 *  the tokens as a storage state, plus the ids of one lead, property and deal for the detail pages. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error("E2E_PASSWORD is not set: run the tests through `npm run e2e` (e2e/stack.mjs starts the stack).");
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  const api = await request.newContext({ baseURL });
  let managerToken = "";
  for (const role of Object.keys(ROLES) as Role[]) {
    const res = await api.post("/api/auth/login/", { data: { email: ROLES[role], password } });
    if (!res.ok()) throw new Error(`login failed for ${role}: HTTP ${res.status()}`);
    const { access, refresh } = (await res.json()) as { access: string; refresh: string };
    if (role === "manager") managerToken = access;
    const state = {
      cookies: [],
      origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "crm.access", value: access }, { name: "crm.refresh", value: refresh }] }],
    };
    fs.writeFileSync(path.join(AUTH_DIR, `${role}.json`), JSON.stringify(state));
  }
  const first = async (resource: string) => {
    const res = await api.get(`/api/${resource}/?page_size=1`, { headers: { Authorization: `Bearer ${managerToken}` } });
    const body = (await res.json()) as { results?: { id: number }[] };
    return body.results?.[0]?.id;
  };
  // the detail pages of the plain demo records are looked up BEFORE the long-text records exist, so they stay the plain ones
  const seeded = { lead: await first("leads"), property: await first("properties"), deal: await first("deals") };
  // long Arabic / unbroken text records are created here, once and sequentially (two workers creating properties at the same moment hit a
  // backend race on the property reference, reported separately); the screens are checked against them in long-text.spec.ts
  const auth = { Authorization: `Bearer ${managerToken}` };
  const lead = await api.post("/api/leads/", { headers: auth, data: { first_name: LONG.arabicName, last_name: LONG.arabicUnbroken, phone: LONG.phones[0], email: `${LONG.latinUnbroken.slice(0, 30)}@example.test`, preferred_location: `${LONG.arabicName} ${LONG.arabicUnbroken}`.slice(0, 110) } });
  if (!lead.ok()) throw new Error(`long-text lead: HTTP ${lead.status()} ${await lead.text()}`);
  const longLead = ((await lead.json()) as { id: number }).id;
  await api.post(`/api/leads/${longLead}/notes/`, { headers: auth, data: { body: `${LONG.arabicName}
${LONG.arabicUnbroken}
${LONG.latinUnbroken}` } });
  const prop = await api.post("/api/properties/", { headers: auth, data: { title: `${LONG.arabicName} ${LONG.arabicUnbroken}`, address: `${LONG.arabicUnbroken} ${LONG.latinUnbroken}`, city: LONG.arabicUnbroken.slice(0, 60), price: "2500000", property_type: "villa", description: `${LONG.arabicName}
${LONG.latinUnbroken}` } });
  if (!prop.ok()) throw new Error(`long-text property: HTTP ${prop.status()} ${await prop.text()}`);
  const longProperty = ((await prop.json()) as { id: number }).id;
  const ids = { lead: seeded.lead, property: seeded.property, deal: seeded.deal, longLead, longProperty };
  fs.writeFileSync(path.join(AUTH_DIR, "ids.json"), JSON.stringify(ids));
  await api.dispose();
}
