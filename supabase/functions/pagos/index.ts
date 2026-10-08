// Cuartel General · función "pagos" (Wompi, Colombia)
// Para cualquier usuario con sesión:
//  - info: precio del plan Pro.
//  - checkout: arma el link de Wompi con firma de integridad (nadie puede cambiar el precio).
//  - confirmar: al volver de Wompi, le pregunta la transacción a la API de Wompi y, si está aprobada, activa el Pro.
// El webhook "wompi-webhook" hace lo mismo por si el usuario cierra la ventana antes de volver.
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";

const APP_URL = "https://jdrt2005t.github.io/cuartel-general/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const out = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");
const apiBase = (pub: string) => pub.startsWith("pub_test_") ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";

async function wompi() {
  const [c] = await db`select valor from public.cg_config where clave = 'wompi'`;
  const [s] = await db`select decrypted_secret as s from vault.decrypted_secrets where name = 'wompi_integrity_secret' limit 1`;
  return { cfg: c?.valor ?? null, integrity: s?.s ?? "" };
}

// Registra el pago y da el Pro (una sola vez por transacción).
// deno-lint-ignore no-explicit-any
export async function aprobar(tx: any) {
  const ref = String(tx.reference ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return "sin_checkout";
  const [ck] = await db`select * from public.cg_checkouts where id = ${ref}`;
  if (!ck) return "sin_checkout";
  if (tx.status !== "APPROVED") {
    if (["DECLINED", "VOIDED", "ERROR"].includes(tx.status)) await db`update public.cg_checkouts set estado = 'rechazado', pago_id = ${String(tx.id)}, actualizado = now() where id = ${ck.id} and estado = 'pendiente'`;
    return String(tx.status).toLowerCase();
  }
  if (tx.currency !== "COP" || Number(tx.amount_in_cents) < Math.round(Number(ck.monto_local) * 100)) {
    await db`update public.cg_checkouts set estado = 'rechazado', pago_id = ${String(tx.id)}, actualizado = now() where id = ${ck.id}`;
    return "monto_incorrecto";
  }
  await db.begin(async (t) => {
    const ins = await t`insert into public.cg_pagos (user_id, monto_usd, concepto, proveedor, ref_externa, monto_local, moneda)
      values (${ck.user_id}, ${ck.monto_usd}, ${`Plan Pro · ${ck.meses} ${ck.meses === 1 ? "mes" : "meses"} (Wompi · ${String(tx.payment_method_type ?? "").replace(/_/g, " ")})`}, 'wompi', ${String(tx.id)}, ${Number(tx.amount_in_cents) / 100}, 'COP')
      on conflict do nothing returning id`;
    if (ins.length) {
      await t`update public.cg_perfiles set plan = 'pro',
        pro_hasta = greatest(now(), coalesce(case when plan = 'pro' then pro_hasta end, now())) + make_interval(months => ${ck.meses}::int)
        where id = ${ck.user_id}`;
    }
    await t`update public.cg_checkouts set estado = 'aprobado', pago_id = ${String(tx.id)}, actualizado = now() where id = ${ck.id}`;
  });
  return "approved";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ ok: false, error: "Usá POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return out({ ok: false, error: "Tu sesión venció. Iniciá sesión de nuevo." }, 401);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return out({ ok: false, error: "Pedido inválido" }); }
  const { cfg, integrity } = await wompi();
  const listo = !!(cfg?.public_key && integrity && cfg?.precio_local);

  try {
    if (b.action === "info") {
      if (!listo) return out({ ok: true, disponible: false });
      return out({ ok: true, disponible: true, precio_local: cfg.precio_local, moneda: "COP", precio_usd: cfg.precio_usd, meses: 1, prueba: cfg.public_key.startsWith("pub_test_") });
    }
    if (b.action === "checkout") {
      if (!listo) return out({ ok: false, error: "Los pagos todavía no están activados. Avisale al administrador." });
      const [p] = await db`select activo from public.cg_perfiles where id = ${user.id}`;
      if (!p?.activo) return out({ ok: false, error: "Tu cuenta no está habilitada." });
      const [n] = await db`select count(*)::int as n from public.cg_checkouts where user_id = ${user.id} and creado > now() - interval '1 hour'`;
      if (n.n >= 6) return out({ ok: false, error: "Abriste muchos pagos seguidos. Esperá un rato y probá de nuevo." });

      const cents = Math.round(Number(cfg.precio_local) * 100);
      const [ck] = await db`insert into public.cg_checkouts (user_id, monto_local, moneda, monto_usd, meses, proveedor)
        values (${user.id}, ${cents / 100}, 'COP', ${cfg.precio_usd}, 1, 'wompi') returning id`;
      const ref = String(ck.id);
      const firma = await sha256(`${ref}${cents}COP${integrity}`);
      const q = new URLSearchParams({
        "public-key": cfg.public_key, currency: "COP", "amount-in-cents": String(cents), reference: ref,
        "signature:integrity": firma, "redirect-url": APP_URL, "customer-data:email": user.email ?? "",
      });
      return out({ ok: true, url: `https://checkout.wompi.co/p/?${q.toString()}` });
    }
    if (b.action === "confirmar") {
      const id = String(b.id ?? "");
      if (!/^[\w-]{5,60}$/.test(id) || !cfg?.public_key) return out({ ok: false, error: "Pago no encontrado." });
      const r = await fetch(`${apiBase(cfg.public_key)}/transactions/${encodeURIComponent(id)}`);
      if (!r.ok) return out({ ok: false, error: "Wompi todavía no tiene ese pago. Probá en un momento." });
      const tx = (await r.json()).data;
      const [ck] = await db`select user_id from public.cg_checkouts where id::text = ${String(tx?.reference ?? "")}`;
      if (!ck || ck.user_id !== user.id) return out({ ok: false, error: "Ese pago no es de tu cuenta." });
      const estado = await aprobar(tx);
      return out({ ok: true, estado, status: tx.status });
    }
    return out({ ok: false, error: "Acción desconocida" });
  } catch (e) {
    return out({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
  }
});
