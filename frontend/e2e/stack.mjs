// Starts a throw-away, fully local stack, runs the Playwright tests against it, and removes everything again.
//
//   npm run e2e                       all tests
//   npm run e2e -- --grep "phone"     any Playwright option
//   npm run e2e:clean                 remove leftovers of a run that was killed hard (labelled crm-e2e)
//
// The stack: PostgreSQL 16 (throw-away container, random password) + the REAL backend image (target "prod", gunicorn) seeded with the demo
// dataset + the PRODUCTION build of this frontend (next build / next start).
//
// Safety:
//  * nothing real can be reached: the backend gets only the variables listed below (never this shell's environment), no external service
//    is configured, every password is generated for the run, the demo seed is only invoked here (it refuses outside DEBUG), and the browser
//    is guarded in the tests (any request outside the local stack fails the test, see e2e/fixtures.ts);
//  * the run is isolated: unique container, network and image-independent names with a run id, free ports picked at start, so two runs (or a
//    run and your own dev containers) never touch each other's resources;
//  * everything it created is removed in `finally`, on failing tests, on a build error, and on Ctrl+C / termination signals. A hard kill
//    (taskkill, power loss) cannot run any code: `npm run e2e:clean` removes what is left, labelled crm-e2e.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "..");
const backend = path.resolve(frontend, "..", "backend");
const LABEL = "crm-e2e";
const IMAGE = "crm-backend:e2e";

const docker = (args, { quiet = false, allowFail = false } = {}) => {
  try {
    return execFileSync("docker", args, { stdio: quiet ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"], encoding: "utf8" });
  } catch (e) {
    if (allowFail) return "";
    throw e;
  }
};

// Removes a container only if `isOurs(crm-e2e label, crm-e2e-run label)` says so. `-v` deletes the ANONYMOUS volumes of that one container
// (never a named volume); if it ever held a named volume it is removed without -v. Returns whether it was removed.
function rmOwn(name, isOurs) {
  const out = docker(["inspect", "-f", '{{index .Config.Labels "crm-e2e"}}|{{index .Config.Labels "crm-e2e-run"}}|{{range .Mounts}}{{.Type}}:{{.Name}} {{end}}', name], { quiet: true, allowFail: true }).trim();
  if (!out) return false;
  const [lab, runLabel, mounts = ""] = out.split("|");
  if (!isOurs(lab, runLabel)) return false;
  const named = mounts.split(/\s+/).filter((m) => m.startsWith("volume:") && !/^volume:[0-9a-f]{64}$/.test(m));
  docker(["rm", "-f", ...(named.length ? [] : ["-v"]), name], { quiet: true, allowFail: true });
  return true;
}

// ---- `--clean`: remove everything labelled crm-e2e (only ever our own throw-away resources) ------------------------------------------------
if (process.argv.includes("--clean")) {
  const all = docker(["ps", "-aq", "--filter", `label=${LABEL}`], { quiet: true, allowFail: true }).split(/\s+/).filter(Boolean);
  const ids = all.filter((id) => rmOwn(id, (lab) => lab === "1"));
  const nets = docker(["network", "ls", "-q", "--filter", `label=${LABEL}`], { quiet: true, allowFail: true }).split(/\s+/).filter(Boolean);
  if (nets.length) docker(["network", "rm", ...nets], { quiet: true, allowFail: true });
  console.log(`removed ${ids.length} container(s) and ${nets.length} network(s) labelled ${LABEL}`);
  process.exit(0);
}

const rand = (n) => crypto.randomBytes(48).toString("base64").replace(/[^A-Za-z0-9]/g, "").slice(0, n);
const run = rand(8).toLowerCase();
const NET = `${LABEL}-${run}`;
const DB = `${LABEL}-${run}-db`;
const BE = `${LABEL}-${run}-be`;
const dbPassword = rand(24);
const demoPassword = `E2e${rand(16)}!9`;
const labels = ["--label", `${LABEL}=1`, "--label", `${LABEL}-run=${run}`];
const log = (m) => console.log(`\n== ${m} ==`);

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

// A local env file could silently point the build at a real API (Next inlines NEXT_PUBLIC_* at build time): refuse to run if one does.
for (const f of fs.readdirSync(frontend).filter((n) => /^\.env/.test(n) && n !== ".env.example")) {
  const text = fs.readFileSync(path.join(frontend, f), "utf8");
  if (/^\s*(NEXT_PUBLIC_API_URL|BACKEND_INTERNAL_URL|NEXT_PUBLIC_DEMO_MODE|NEXT_PUBLIC_DEMO_PASSWORD)\s*=/m.test(text)) {
    console.error(`STACK ERROR: frontend/${f} sets an API or demo variable. Move it away for the test run so the build cannot point anywhere but the local stack.`);
    process.exit(2);
  }
}

const backendEnv = [
  "-e", `DATABASE_URL=postgres://postgres:${dbPassword}@${DB}:5432/postgres`,
  "-e", "DJANGO_DEBUG=false",
  "-e", `DJANGO_SECRET_KEY=${rand(60)}`,
  "-e", "DJANGO_ALLOWED_HOSTS=127.0.0.1,localhost",
  "-e", "DJANGO_SECURE_SSL_REDIRECT=false",
  "-e", "DJANGO_CORS_ALLOWED_ORIGINS=",
  "-e", "DEMO_MODE=false",
  "-e", "RUN_MIGRATIONS=false",
];

let nextProc = null;
let testProc = null;
let cleaned = false;
function killTree(proc) {
  if (!proc || !proc.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-proc.pid, "SIGTERM");
  } catch { /* already gone */ }
}
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  killTree(testProc);
  killTree(nextProc);
  for (const name of [BE, DB]) rmOwn(name, (_, r) => r === run);
  docker(["network", "rm", NET], { quiet: true, allowFail: true });
}
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

async function waitFor(url, label, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${label} did not come up at ${url}`);
}

let code = 1;
try {
  const backendPort = await freePort();
  const frontendPort = await freePort();
  log(`run ${run}: backend image (production target)`);
  docker(["build", "-q", "--target", "prod", "-t", IMAGE, backend]);
  log("throw-away PostgreSQL");
  docker(["network", "create", ...labels, NET], { quiet: true });
  // The postgres image declares VOLUME /var/lib/postgresql/data: without a mount there Docker would create an anonymous volume per run that
  // `docker rm` leaves behind. The data is throw-away, so it lives in a tmpfs and no volume can exist.
  docker(["run", "-d", "--name", DB, ...labels, "--network", NET, "--tmpfs", "/var/lib/postgresql/data:rw,size=512m", "-e", `POSTGRES_PASSWORD=${dbPassword}`, "postgres:16-alpine"], { quiet: true });
  // leak guard: the database container must not hold any volume (fail closed; `finally` removes it together with whatever anonymous volume it has)
  const dbVolumes = docker(["inspect", "-f", '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}', DB], { quiet: true }).trim();
  if (dbVolumes) throw new Error(`leak guard: the throw-away database holds volume(s): ${dbVolumes}`);
  for (let i = 0; i < 60; i++) {
    try { docker(["exec", DB, "pg_isready", "-h", "127.0.0.1", "-U", "postgres", "-q"], { quiet: true }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  log("migrate and seed the demo dataset");
  docker(["run", "--rm", ...labels, "--network", NET, ...backendEnv, "--entrypoint", "python", IMAGE, "manage.py", "migrate", "--noinput", "-v", "0"], { quiet: true });
  docker(["run", "--rm", ...labels, "--network", NET, ...backendEnv, "-e", "DJANGO_DEBUG=true", "-e", `DEMO_PASSWORD=${demoPassword}`, "--entrypoint", "python", IMAGE, "manage.py", "seed_demo", "--force"], { quiet: true });
  log("backend server");
  docker(["run", "-d", "--name", BE, ...labels, "--network", NET, "-p", `127.0.0.1:${backendPort}:8000`, ...backendEnv, IMAGE, "gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2"], { quiet: true });
  await waitFor(`http://127.0.0.1:${backendPort}/api/health/`, "the backend");

  const env = { ...process.env, BACKEND_INTERNAL_URL: `http://127.0.0.1:${backendPort}`, NEXT_TELEMETRY_DISABLED: "1" };
  delete env.NEXT_PUBLIC_API_URL; // same-origin: the browser calls /api on the frontend, which proxies to the backend
  delete env.NEXT_PUBLIC_DEMO_MODE;
  delete env.NEXT_PUBLIC_DEMO_PASSWORD;
  delete env.I18N_PSEUDO; // only the pseudo-locale phase below sets it (and it is refused for a standalone or Vercel build, see next.config.mjs)
  const nextBin = path.join(frontend, "node_modules", "next", "dist", "bin", "next");
  const pw = path.join(frontend, "node_modules", "@playwright", "test", "cli.js");

  // Phases: the pseudo-locale layout tests run against their OWN build (I18N_PSEUDO=1, accented and about 35% longer English made in memory from the real
  // catalogue); the product's suite runs against the normal build, last, so that .next ends as the normal build. With no arguments both run; with an argument
  // that names the pseudo spec only that phase runs; any other argument selects the normal suite alone (a filter such as -g keeps working as before).
  const args = process.argv.slice(2);
  const pseudoRequested = args.some((a) => /pseudo/i.test(a));
  const phases = pseudoRequested
    ? [{ name: "pseudo-locale", pseudo: true, args: ["--project=pseudo", ...args] }]
    : args.length === 0
      ? [{ name: "pseudo-locale", pseudo: true, args: ["--project=pseudo"] }, { name: "product", pseudo: false, args: ["--project=chromium"] }]
      : [{ name: "product", pseudo: false, args: ["--project=chromium", ...args] }];
  code = 0;
  for (const phase of phases) {
    const phaseEnv = phase.pseudo ? { ...env, I18N_PSEUDO: "1" } : env;
    const port = phase.pseudo ? await freePort() : frontendPort;
    log(`frontend production build (${phase.name})`);
    execFileSync(process.execPath, [nextBin, "build"], { cwd: frontend, env: phaseEnv, stdio: "inherit" });
    log(`frontend server (${phase.name})`);
    nextProc = spawn(process.execPath, [nextBin, "start", "-p", String(port)], { cwd: frontend, env: phaseEnv, stdio: "ignore", detached: process.platform !== "win32" });
    await waitFor(`http://127.0.0.1:${port}/login`, "the frontend");
    log(`Playwright (${phase.name})`);
    testProc = spawn(process.execPath, [pw, "test", ...phase.args], {
      cwd: frontend,
      stdio: "inherit",
      env: { ...process.env, E2E_BASE_URL: `http://127.0.0.1:${port}`, E2E_PASSWORD: demoPassword },
    });
    const phaseCode = await new Promise((resolve) => testProc.on("exit", (c) => resolve(c ?? 1)));
    if (phaseCode !== 0 && code === 0) code = phaseCode;
    killTree(testProc);
    killTree(nextProc);
    testProc = null;
    nextProc = null;
  }
} catch (e) {
  console.error(`\nSTACK ERROR: ${e.message}`);
  code = 2;
} finally {
  cleanup();
}
process.exit(code);
