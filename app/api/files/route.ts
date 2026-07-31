import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<unknown>;
};
type D1 = { prepare: (query: string) => D1Statement };
type Bucket = {
  put: (
    key: string,
    value: ArrayBuffer,
    options: { httpMetadata: { contentType: string }; customMetadata: Record<string, string> },
  ) => Promise<unknown>;
};
const SUPABASE_URL = "https://mnshvsxhntqsmzbvomhe.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_DBOaxRwgSRDSmdBtTEKTsQ_GB_sT8ZA";

export async function POST(request: Request) {
  try {
    const bindings = env as unknown as { DB: D1; FILES: Bucket };
    const authorization = request.headers.get("authorization") || "";
    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, authorization },
    });
    if (!userResponse.ok) {
      return Response.json({ error: "Inicia sesión para importar archivos." }, { status: 401 });
    }
    const user = (await userResponse.json()) as { email?: string };
    const email = (user.email || "").toLowerCase();
    if (email !== "byvera198@gmail.com") {
      const membership = await bindings.DB
        .prepare("SELECT status, expires_at, device_id FROM memberships WHERE email = ?")
        .bind(email)
        .first<{ status: string; expires_at: string | null; device_id: string | null }>();
      const deviceId = request.headers.get("x-device-id") || "";
      if (
        !membership ||
        membership.status !== "approved" ||
        !membership.expires_at ||
        new Date(membership.expires_at).getTime() <= Date.now() ||
        !deviceId ||
        membership.device_id !== deviceId
      ) {
        return Response.json({ error: "La membresía o el dispositivo no están autorizados." }, { status: 403 });
      }
    }
    const name = decodeURIComponent(request.headers.get("x-file-name") || "cartones.pdf");
    const checksum = request.headers.get("x-checksum") || "";
    const gameId = request.headers.get("x-game-id") || "";
    const pages = Number(request.headers.get("x-pages") || "0");
    const cards = Number(request.headers.get("x-cards") || "0");
    const contentType = request.headers.get("content-type")?.toLowerCase() || "";
    const isPdf = contentType.startsWith("application/pdf") || name.toLowerCase().endsWith(".pdf");
    if (!gameId || !checksum || !isPdf) {
      return Response.json({ error: "Archivo PDF incompleto o inválido." }, { status: 400 });
    }
    const ownedGame = await bindings.DB
      .prepare("SELECT owner_email FROM games WHERE id = ?")
      .bind(gameId)
      .first<{ owner_email: string }>();
    if (!ownedGame || ownedGame.owner_email !== email) {
      return Response.json({ error: "Esta partida pertenece a otro usuario." }, { status: 403 });
    }
    const duplicate = await bindings.DB
      .prepare("SELECT id FROM files WHERE game_id = ? AND checksum = ?")
      .bind(gameId, checksum)
      .first<{ id: string }>();
    if (duplicate) {
      return Response.json({ error: "Este PDF ya fue importado.", duplicate: true }, { status: 409 });
    }
    const bytes = await request.arrayBuffer();
    const id = crypto.randomUUID();
    const storageKey = `${gameId}/${id}-${name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    await bindings.FILES.put(storageKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
      customMetadata: { originalName: name, checksum, gameId },
    });
    const createdAt = new Date().toISOString();
    await bindings.DB
      .prepare(
        `INSERT INTO files (
          id, game_id, name, storage_key, size, checksum, pages, cards, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, gameId, name, storageKey, bytes.byteLength, checksum, pages, cards, createdAt)
      .run();
    return Response.json({ id, name, size: bytes.byteLength, checksum, pages, cards, createdAt });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo almacenar el PDF." },
      { status: 500 },
    );
  }
}
