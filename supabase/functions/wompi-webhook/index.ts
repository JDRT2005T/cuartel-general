// Cuartel General · función "wompi-webhook"
// Wompi avisa acá cuando cambia una transacción (evento "transaction.updated").
// Se verifica la firma del evento con el "secreto de eventos" guardado en Vault (SHA256 de las propiedades
// indicadas + timestamp + secreto). Si no coincide, se descarta. Si coincide y está aprobada, se registra
// el pago y se activa el Pro (una sola vez por transacción).
import postgres from "npm:postgres@3";

const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const ok = (status = 200) => new Response("ok", { status });
const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))), (b) => b.toString(16).padStart(2, "0")).join("");

// deno-lint-ignore no-explicit-any
async function aprobar(tx: any) {
  const ref = String(tx.reference ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(ref)) return;
  const [ck] = await db`select * from public.cg_checkouts where id = ${ref}`;
  if (!ck) return;
  if (tx.status !== "APPROVED") {
    if (["DECLINED", "VOIDED", "ERROR"].includes(tx.status)) await db`update public.cg_checkouts set estado = 'rechazado', pago_id = ${String(tx.id)}, actualizado = now() where id = ${ck.id} and estado = 'pendiente'`;
    return;
  }
  if (tx.currency !== "COP" || Number(tx.amount_in_cents) < Math.round(Number(ck.monto_local) * 100)) {
    await db`update public.cg_checkouts set estado = 'rechazado', pago_id = ${String(tx.id)}, actualizado = now() where id = ${ck.id}`;
    return;
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
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return ok();
  // deno-lint-ignore no-explicit-any
  let ev: any;
  try { ev = await req.json(); } catch { return ok(); }
  if (ev?.event !== "transaction.updated" || !ev?.data?.transaction) return ok();

  const [s] = await db`select decrypted_secret as s from vault.decrypted_secrets where name = 'wompi_events_secret' limit 1`;
  if (!s?.s) return ok();

  const props: string[] = Array.isArray(ev.signature?.properties) ? ev.signature.properties : [];
  // deno-lint-ignore no-explicit-any
  const valor = (ruta: string) => ruta.split(".").reduce((o: any, k) => o?.[k], ev.data);
  const calculado = await sha256(props.map((p) => String(valor(p) ?? "")).join("") + String(ev.timestamp ?? "") + s.s);
  const recibido = String(ev.signature?.checksum ?? req.headers.get("x-event-checksum") ?? "");
  if (!props.length || calculado.toLowerCase() !== recibido.toLowerCase()) return ok(401);

  try { await aprobar(ev.data.transaction); } catch (_) { return ok(500); } // Wompi reintenta
  return ok();
});
