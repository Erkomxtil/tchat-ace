import { getStore } from "@netlify/blobs";

// Le serveur ne manipule que des données déjà chiffrées par le navigateur.
// Il ne connaît ni le mot de passe, ni le nom du salon, ni le contenu des messages.

const ROOM_RE = /^[a-f0-9]{64}$/;          // identifiant opaque dérivé côté client
const MAX_PAYLOAD = 12_000;                 // caractères de base64 par message
const MAX_RETURNED = 250;                   // messages renvoyés par requête
const RETENTION_MS = 1000 * 60 * 60 * 48;   // 48 h de conservation

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const store = () => getStore({ name: "tchat", consistency: "strong" });

// Clé : <room>/<horodatage 13 chiffres>-<aléa>
const keyTimestamp = (key) => Number(key.split("/")[1]?.split("-")[0]) || 0;

async function purge(s, room) {
  const { blobs } = await s.list({ prefix: `${room}/` });
  const cutoff = Date.now() - RETENTION_MS;
  const sorted = blobs.map((b) => b.key).sort();
  const excess = Math.max(0, sorted.length - 1000);
  const doomed = sorted.filter((k, i) => i < excess || keyTimestamp(k) < cutoff);
  await Promise.all(doomed.map((k) => s.delete(k)));
}

export default async (req) => {
  const url = new URL(req.url);
  const room = url.searchParams.get("room") || "";
  if (!ROOM_RE.test(room)) return json({ error: "salon invalide" }, 400);

  const s = store();

  if (req.method === "GET") {
    const since = Number(url.searchParams.get("since")) || 0;
    const { blobs } = await s.list({ prefix: `${room}/` });
    const keys = blobs
      .map((b) => b.key)
      .filter((k) => keyTimestamp(k) > since)
      .sort()
      .slice(-MAX_RETURNED);

    const messages = [];
    for (let i = 0; i < keys.length; i += 20) {
      const batch = await Promise.all(
        keys.slice(i, i + 20).map(async (k) => {
          const data = await s.get(k, { type: "text" });
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
    await s.set(`${room}/${id}`, data);
    if (Math.random() < 0.1) await purge(s, room).catch(() => {});
    return json({ id, ts: keyTimestamp(`${room}/${id}`) }, 201);
  }

  if (req.method === "DELETE") {
    const { blobs } = await s.list({ prefix: `${room}/` });
    await Promise.all(blobs.map((b) => s.delete(b.key)));
    return json({ deleted: blobs.length });
  }

  return json({ error: "méthode non autorisée" }, 405);
};

export const config = { path: "/api/messages" };
