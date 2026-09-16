// Relais de messages chiffrés — version instrumentée.
// Le serveur ne manipule que des données déjà chiffrées par le navigateur.

const ROOM_RE = /^[a-f0-9]{64}$/;
const MAX_PAYLOAD = 12_000;
const MAX_RETURNED = 250;
const RETENTION_MS = 1000 * 60 * 60 * 48;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

// Import dynamique : si la bibliothèque manque, on le dit clairement
// au lieu de faire planter la fonction entière au chargement.
async function openStore() {
  let mod;
  try {
    mod = await import("@netlify/blobs");
  } catch (e) {
    throw new Error(
      "La bibliothèque @netlify/blobs n'est pas installée. " +
      "Vérifiez que package.json est à la racine du dépôt et relancez le déploiement. " +
      "(" + e.message + ")"
    );
  }
  try {
    return mod.getStore({ name: "tchat", consistency: "strong" });
  } catch {
    return mod.getStore("tchat"); // repli pour les anciennes versions
  }
}

const keyTimestamp = (key) => Number(key.split("/")[1]?.split("-")[0]) || 0;

async function purge(store, room) {
  const { blobs } = await store.list({ prefix: `${room}/` });
  const cutoff = Date.now() - RETENTION_MS;
  const sorted = blobs.map((b) => b.key).sort();
  const excess = Math.max(0, sorted.length - 1000);
  const doomed = sorted.filter((k, i) => i < excess || keyTimestamp(k) < cutoff);
  await Promise.all(doomed.map((k) => store.delete(k)));
}

async function handle(req) {
  const url = new URL(req.url);

  // Vérification de santé : /api/messages?diag=1
  if (url.searchParams.get("diag")) {
    const store = await openStore();
    const probe = `diag/${Date.now()}`;
    await store.set(probe, "ok");
    const back = await store.get(probe, { type: "text" });
    await store.delete(probe);
    return json({ ok: back === "ok", runtime: globalThis.Netlify ? "netlify" : "inconnu" });
  }

  const room = url.searchParams.get("room") || "";
  if (!ROOM_RE.test(room)) return json({ error: "salon invalide" }, 400);

  const store = await openStore();

  if (req.method === "GET") {
    const since = Number(url.searchParams.get("since")) || 0;
    const { blobs } = await store.list({ prefix: `${room}/` });
    const keys = blobs
      .map((b) => b.key)
      .filter((k) => keyTimestamp(k) > since)
      .sort()
      .slice(-MAX_RETURNED);

    const messages = [];
    for (let i = 0; i < keys.length; i += 20) {
      const batch = await Promise.all(
        keys.slice(i, i + 20).map(async (k) => {
          const data = await store.get(k, { type: "text" });
          return data ? { id: k.split("/")[1], ts: keyTimestamp(k), data } : null;
        })
      );
      messages.push(...batch.filter(Boolean));
    }
    return json({ messages, now: Date.now() });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json({ error: "corps illisible" }, 400);
    }
    const data = typeof body?.data === "string" ? body.data : "";
    if (!data || data.length > MAX_PAYLOAD) return json({ error: "message hors limites" }, 400);
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) return json({ error: "message hors limites" }, 400);

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    await store.set(`${room}/${id}`, data);
    if (Math.random() < 0.1) await purge(store, room).catch(() => {});
    return json({ id, ts: Number(id.split("-")[0]) }, 201);
  }

  if (req.method === "DELETE") {
    const { blobs } = await store.list({ prefix: `${room}/` });
    await Promise.all(blobs.map((b) => store.delete(b.key)));
    return json({ deleted: blobs.length });
  }

  return json({ error: "méthode non autorisée" }, 405);
}

export default async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("tchat:", e);
    return json({ error: e.message, nom: e.name }, 500);
  }
};

export const config = { path: "/api/messages" };
