// Cuartel General · función "pagos"
// Para cualquier usuario con sesión: ver el precio del plan Pro y crear el link de pago de Mercado Pago.
// La activación del Pro NO pasa por acá: la hace "mp-webhook" cuando Mercado Pago confirma el pago.
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

async function mpConfig() {
  const [c] = await db`select valor from public.cg_config where clave = 'mp'`;
  const [t] = await db`select decrypted_secret as s from vault.decrypted_secrets where name = 'mp_access_token' limit 1`;
  return { cfg: c?.valor ?? null, token: t?.s ?? "" };
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
  const { cfg, token: mpToken } = await mpConfig();

  try {
    if (b.action === "info") {
      if (!cfg || !mpToken) return out({ ok: true, disponible: false });
      return out({ ok: true, disponible: true, precio_local: cfg.precio_local, moneda: cfg.moneda, precio_usd: cfg.precio_usd, meses: cfg.meses ?? 1 });
    }
    if (b.action === "checkout") {
      if (!cfg || !mpToken) return out({ ok: false, error: "Los pagos todavía no están activados. Avisale al administrador." });
      const [p] = await db`select activo from public.cg_perfiles where id = ${user.id}`;
      if (!p?.activo) return out({ ok: false, error: "Tu cuenta no está habilitada." });
      const [n] = await db`select count(*)::int as n from public.cg_checkouts where user_id = ${user.id} and creado > now() - interval '1 hour'`;
      if (n.n >= 6) return out({ ok: false, error: "Abriste muchos pagos seguidos. Esperá un rato y probá de nuevo." });

      const meses = Number(cfg.meses) || 1;
      const [ck] = await db`insert into public.cg_checkouts (user_id, monto_local, moneda, monto_usd, meses)
        values (${user.id}, ${cfg.precio_local}, ${cfg.moneda}, ${cfg.precio_usd}, ${meses}) returning id`;
      const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
        method: "POST",
        headers: { Authorization: `Bearer ${mpToken}`, "Content-Type": "application/json", "X-Idempotency-Key": ck.id },
        body: JSON.stringify({
          items: [{ id: "pro", title: `Cuartel General · Plan Pro (${meses} ${meses === 1 ? "mes" : "meses"})`, quantity: 1, unit_price: Number(cfg.precio_local), currency_id: cfg.moneda }],
          payer: { email: user.email },
          external_reference: ck.id,
          back_urls: { success: APP_URL + "?pago=ok", pending: APP_URL + "?pago=pendiente", failure: APP_URL + "?pago=fallo" },
          auto_return: "approved",
          notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
          statement_descriptor: "CUARTEL GENERAL",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.init_point) {
        await db`update public.cg_checkouts set estado = 'rechazado', actualizado = now() where id = ${ck.id}`;
        return out({ ok: false, error: "Mercado Pago no pudo crear el pago: " + String(j.message ?? r.status).slice(0, 200) });
      }
      await db`update public.cg_checkouts set preferencia = ${String(j.id)}, actualizado = now() where id = ${ck.id}`;
      return out({ ok: true, url: j.init_point });
    }
    return out({ ok: false, error: "Acción desconocida" });
  } catch (e) {
    return out({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 300) });
  }
});
