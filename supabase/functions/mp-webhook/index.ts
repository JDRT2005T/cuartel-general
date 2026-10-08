// Cuartel General · función "mp-webhook"
// Mercado Pago avisa acá cuando cambia un pago. No se confía en lo que llega en el aviso:
// con el id se le pregunta el pago a la API de Mercado Pago (con la clave guardada en Vault) y solo
// si está aprobado, por el monto y la moneda correctos, se registra y se activa el Pro. Es idempotente.
import postgres from "npm:postgres@3";

const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const ok = (status = 200) => new Response("ok", { status });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  let id = url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "";
  let type = url.searchParams.get("type") ?? url.searchParams.get("topic") ?? "";
  try { const b = await req.json(); id = id || String(b?.data?.id ?? ""); type = type || String(b?.type ?? b?.topic ?? ""); } catch { /* aviso sin cuerpo */ }
  if (type !== "payment" || !/^\d{1,30}$/.test(id)) return ok();

  const [t] = await db`select decrypted_secret as s from vault.decrypted_secrets where name = 'mp_access_token' limit 1`;
  if (!t?.s) return ok();

  const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, { headers: { Authorization: `Bearer ${t.s}` } });
  if (r.status === 404) return ok();
  if (!r.ok) return ok(500); // Mercado Pago reintenta más tarde
  const p = await r.json();

  const ref = String(p.external_reference ?? "");
  if (!UUID.test(ref)) return ok();
  const [ck] = await db`select * from public.cg_checkouts where id = ${ref}`;
  if (!ck) return ok();

  if (p.status === "approved") {
    const pagoOk = p.currency_id === ck.moneda && Number(p.transaction_amount) >= Number(ck.monto_local) - 0.01;
    if (!pagoOk) {
      await db`update public.cg_checkouts set estado = 'rechazado', pago_id = ${id}, actualizado = now() where id = ${ck.id}`;
      return ok();
    }
    await db.begin(async (tx) => {
      const ins = await tx`insert into public.cg_pagos (user_id, monto_usd, concepto, proveedor, ref_externa, monto_local, moneda)
        values (${ck.user_id}, ${ck.monto_usd}, ${`Plan Pro · ${ck.meses} ${ck.meses === 1 ? "mes" : "meses"} (Mercado Pago)`}, 'mercadopago', ${id}, ${p.transaction_amount}, ${p.currency_id})
        on conflict do nothing returning id`;
      if (ins.length) {
        await tx`update public.cg_perfiles set plan = 'pro',
          pro_hasta = greatest(now(), coalesce(case when plan = 'pro' then pro_hasta end, now())) + make_interval(months => ${ck.meses}::int)
          where id = ${ck.user_id}`;
      }
      await tx`update public.cg_checkouts set estado = 'aprobado', pago_id = ${id}, actualizado = now() where id = ${ck.id}`;
    });
  } else if (p.status === "rejected" || p.status === "cancelled") {
    await db`update public.cg_checkouts set estado = 'rechazado', pago_id = ${id}, actualizado = now() where id = ${ck.id} and estado = 'pendiente'`;
  }
  return ok();
});
