"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Users, Check, AlertTriangle } from "lucide-react";
import type { AccessState, Membership } from "@/lib/bingo";
import { membershipNotice, type CommunityState } from "@/lib/member-services";
import { authorizationHeaders } from "@/lib/supabase-client";

async function requestCommunity(deviceId: string, body?: Record<string, unknown>) {
  const response = await fetch(body ? "/api/state" : "/api/state?scope=community", {
    method: body ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { ...await authorizationHeaders(), "x-device-id": deviceId, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null) as ({ error?: string } & Record<string, unknown>) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || "No se pudo actualizar la comunicación. Se reintentará automáticamente.");
  return payload;
}

export function MembershipWarning({ expiresAt }: { expiresAt?: string | null }) {
  const [time, setTime] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setTime(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  const notice = membershipNotice(expiresAt, time);
  if (!notice) return null;
  return <aside className="membership-expiry-notice" role="status">
    <AlertTriangle size={22} /><div><strong>{notice.expired ? "Membresía vencida" : "Tu membresía está próxima a vencer"}</strong><p>{notice.text}</p>
      <a href="https://wa.me/593985280991?text=Hola%2C%20deseo%20renovar%20mi%20membres%C3%ADa%20de%20Bingo%20Control%20Promax" target="_blank" rel="noreferrer">Solicitar renovación por WhatsApp</a>
    </div>
  </aside>;
}

export default function MemberCommunity({ access, gameId, deviceId, showAdmin, memberships = [] }: {
  access: AccessState; gameId: string; deviceId: string; showAdmin: boolean; memberships?: Membership[];
}) {
  const [data, setData] = useState<CommunityState>({ messages: [] });
  const [error, setError] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [recipient, setRecipient] = useState("");
  const [sending, setSending] = useState(false);
  const [receipt, setReceipt] = useState("");
  const sessionId = useRef("");
  const draftId = useRef("");
  const sendingRef = useRef(false);

  const refresh = useCallback(async () => {
    const state = await requestCommunity(deviceId) as unknown as CommunityState;
    setData(state); setError(""); setLastSync(new Date().toLocaleTimeString("es-EC"));
  }, [deviceId]);

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    sessionId.current ||= crypto.randomUUID();
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const visible = document.visibilityState === "visible";
        await requestCommunity(deviceId, { action: "presence", sessionId: sessionId.current, gameId, visible });
        if (visible && !disposed) await refresh();
      } catch (caught) {
        if (!disposed) setError(caught instanceof Error ? caught.message : "No se pudo conectar.");
      } finally { inFlight = false; }
    };
    void tick();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void tick(); }, 45_000);
    document.addEventListener("visibilitychange", tick);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [deviceId, gameId, access.email, refresh]);

  const send = async () => {
    if (sendingRef.current || !message.trim()) return;
    if (!window.confirm(recipient ? `¿Enviar este mensaje a ${recipient}?` : "¿Enviar este mensaje a todos los usuarios registrados?")) return;
    sendingRef.current = true; setSending(true); setReceipt("");
    draftId.current ||= crypto.randomUUID();
    try {
      await requestCommunity(deviceId, { action: "sendMemberMessage", messageId: draftId.current, message, recipient });
      setMessage(""); draftId.current = ""; setReceipt("Mensaje guardado. Los usuarios lo verán al abrir la aplicación o en la próxima actualización.");
      await refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo enviar."); }
    finally { sendingRef.current = false; setSending(false); }
  };

  return <>
    <MembershipWarning expiresAt={access.membership?.expiresAt} />
    {data.messages.length > 0 && <section className="member-inbox" aria-label="Mensajes del administrador" aria-live="polite">
      {data.messages.map((item) => <article key={item.id} className="member-message">
        <MessageCircle size={21} /><div><strong>Mensaje del administrador</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString("es-EC")}</small></div>
        <button className="secondary-button compact" type="button" onClick={() => {
          void requestCommunity(deviceId, { action: "readMemberMessage", messageId: item.id }).then(refresh).catch((caught) => setError(String(caught.message)));
        }}><Check size={15} /> Leído</button>
      </article>)}
    </section>}
    {error && <p className="community-error" role="status">Avisos y conexión: {error} El juego se mantiene independiente.</p>}
    {showAdmin && access.role === "admin" && <section className="panel community-panel">
      <header className="panel-heading"><div><span className="eyebrow">COMUNIDAD</span><h3><Users size={20} /> Usuarios conectados</h3></div>
        <button className="secondary-button compact" type="button" onClick={() => void refresh().catch((caught) => setError(caught.message))}>Actualizar</button></header>
      <div className="community-body">
        <p><strong>{lastSync ? data.online?.length ?? 0 : "—"}</strong> conectados · <strong>{lastSync ? data.online?.filter((item) => item.playing).length ?? 0 : "—"}</strong> con partida en juego</p>
        <small>Actividad de los últimos 2 minutos, con la aplicación visible. Actualización cada 45 segundos{lastSync ? ` · Última: ${lastSync}` : ""}.</small>
        <ul className="online-members">{data.online?.map((person) => <li key={person.email}><span><strong>{person.name}</strong><small>{person.email}</small></span><b>{person.playing ? "Jugando" : "Conectado"}</b></li>)}</ul>
        <h3>Enviar mensaje en la aplicación</h3>
        <label>Destinatario<select value={recipient} disabled={sending} onChange={(event) => { setRecipient(event.target.value); draftId.current = ""; }}>
          <option value="">Todos los usuarios registrados</option>
          {memberships.filter((item) => item.status === "approved").map((item) => <option key={item.id} value={item.email}>{item.name || item.email} · {item.email}</option>)}
        </select></label>
        <label>Mensaje<textarea rows={4} maxLength={2000} value={message} disabled={sending} onChange={(event) => { setMessage(event.target.value); draftId.current = ""; }} placeholder="Escribe un aviso para los usuarios…" /></label>
        <div className="community-send"><small>{message.length}/2000 · Se entrega dentro de la aplicación; no envía WhatsApp ni correo.</small><button className="primary-button" disabled={sending || !message.trim()} type="button" onClick={() => void send()}>{sending ? "Enviando…" : "Enviar mensaje"}</button></div>
        {receipt && <p role="status">{receipt}</p>}
        {!!data.sent?.length && <details><summary>Últimos mensajes enviados</summary>{data.sent.map((item) => <article className="sent-message" key={item.id}><small>{item.recipient || "Todos"} · {new Date(item.createdAt).toLocaleString("es-EC")}</small><p>{item.body}</p></article>)}</details>}
      </div>
    </section>}
  </>;
}
